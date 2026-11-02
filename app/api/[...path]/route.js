import {db} from '../../../lib/db.js';
import {User,Test,Attempt,UploadChunk} from '../../../lib/models.js';
import {CHUNK_BYTES,MAX_PDF_BYTES,savePdfChunk,readPdfChunks,deletePdfChunks} from '../../../lib/uploads.js';
import {useRateLimit} from '../../../lib/rate-limit.js';
import {extractQuestions} from '../../../lib/pdf.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {z,ZodError} from 'zod';
import mongoose from 'mongoose';
import path from 'node:path';
export const runtime='nodejs';
export const maxDuration=300;
export const dynamic='force-dynamic';
const ok=(data,status=200)=>Response.json({data},{status});
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const oid=id=>{if(!mongoose.isValidObjectId(id))throw fail('Invalid ID')};
const userData=u=>({id:u.id,name:u.name,email:u.email});
const sign=u=>jwt.sign({id:u.id},process.env.JWT_SECRET,{expiresIn:'7d'});
const publicTest=t=>({id:t.id,title:t.title,originalPdfName:t.originalPdfName,duration:t.duration,status:t.status,processingError:t.processingError,createdAt:t.createdAt,questions:t.questions.map((q,i)=>({id:q.id,index:i,question:q.question,options:q.options,sourcePage:q.sourcePage,confidence:q.confidence,needsReview:q.needsReview}))});
const attemptData=a=>({id:a.id,testId:a.testId,answers:Object.fromEntries(a.answers||[]),visited:a.visited,startedAt:a.startedAt,expiresAt:a.expiresAt,status:a.status});
const ownedTest=async(id,userId)=>{oid(id);const t=await Test.findOne({_id:id,userId});if(!t)throw fail('Test not found',404);return t};
const ownedAttempt=async(id,userId)=>{oid(id);const a=await Attempt.findOne({_id:id,userId});if(!a)throw fail('Attempt not found',404);return a};
async function finish(a,t,expired=false){if(a.status!=='in_progress')return a;let correct=0,incorrect=0,unattempted=0;for(let i=0;i<t.questions.length;i++){const selected=a.answers?.get(String(i));if(!selected)unattempted++;else if(selected===t.questions[i].correctAnswer)correct++;else incorrect++}a.score=Number((correct-incorrect*0.25).toFixed(2));a.correctCount=correct;a.incorrectCount=incorrect;a.unattemptedCount=unattempted;a.accuracy=correct+incorrect?Math.round(correct/(correct+incorrect)*100):0;a.submittedAt=new Date();a.timeTaken=Math.min(t.duration*60,Math.max(0,Math.round((a.submittedAt-a.startedAt)/1000)));a.status=expired?'expired':'submitted';await a.save();return a}
async function handle(req,ctx){try{if(!process.env.JWT_SECRET||process.env.JWT_SECRET.length<32)throw fail('JWT_SECRET is not configured',500);await db();const segments=(await ctx.params).path||[];const [root,id,action]=segments;const method=req.method;let body;
if(root==='auth'&&id==='register'&&method==='POST'){body=z.object({name:z.string().trim().min(2).max(80),email:z.email(),password:z.string().min(8).max(100)}).parse(await req.json());if(await User.exists({email:body.email.toLowerCase()}))throw fail('Email already registered',409);const u=await User.create({...body,password:await bcrypt.hash(body.password,12)});return ok({token:sign(u),user:userData(u)},201)}
if(root==='auth'&&id==='login'&&method==='POST'){body=z.object({email:z.email(),password:z.string()}).parse(await req.json());const u=await User.findOne({email:body.email.toLowerCase()});if(!u||!await bcrypt.compare(body.password,u.password))throw fail('Invalid email or password',401);return ok({token:sign(u),user:userData(u)})}
let user;try{const token=(req.headers.get('authorization')||'').replace(/^Bearer /,'');const payload=jwt.verify(token,process.env.JWT_SECRET);user=await User.findById(payload.id)}catch{}if(!user)throw fail('Please log in again.',401);
if(root==='auth'&&id==='me'&&method==='GET')return ok(userData(user));
if(root==='tests'&&id==='upload'&&method==='POST'){
  await useRateLimit(user.id,'upload',20);
  const v=z.object({title:z.string().trim().min(2).max(120),duration:z.coerce.number().int().min(1).max(240),originalPdfName:z.string().min(5).max(255).regex(/\.pdf$/i),fileSize:z.number().int().min(5).max(MAX_PDF_BYTES),chunkCount:z.number().int().min(1).max(5)}).parse(await req.json());
  if(v.chunkCount!==Math.ceil(v.fileSize/CHUNK_BYTES))throw fail('Invalid chunk count.');
  const t=await Test.create({userId:user.id,title:v.title,duration:v.duration,originalPdfName:path.basename(v.originalPdfName),expectedBytes:v.fileSize,chunkCount:v.chunkCount,status:'uploading'});
  return ok(publicTest(t),201);
}
if(root==='tests'&&id==='upload')throw fail('Method not allowed',405);
if(root==='tests'&&!id&&method==='GET'){const tests=await Test.find({userId:user.id}).sort({createdAt:-1});return ok(tests.map(t=>({id:t.id,title:t.title,status:t.status,createdAt:t.createdAt,duration:t.duration,questionCount:t.questions.length,processingError:t.processingError})))}
if(root==='tests'&&id){const t=await ownedTest(id,user.id);
if(action==='chunks'&&method==='GET'){const chunks=await UploadChunk.find({testId:t.id}).select('index').lean();return ok({uploaded:chunks.map(chunk=>chunk.index)})}
if(action==='chunks'&&method==='PUT'){
  const index=Number(segments[3]);
  if(!Number.isInteger(index))throw fail('Invalid chunk index.');
  if(req.headers.get('content-type')!=='application/octet-stream')throw fail('Use application/octet-stream.');
  const bytes=Buffer.from(await req.arrayBuffer());
  try{await savePdfChunk(t,user.id,index,bytes)}catch(error){throw fail(error.message)}
  return ok({index});
}
if(action==='process'&&method==='POST'){
  if(t.status==='ready')return ok(publicTest(t));
  const pdf=await readPdfChunks(t).catch(error=>{throw fail(error.message)});
  await useRateLimit(user.id,'process',10);
  const claim=await Test.updateOne({_id:t.id,userId:user.id,$or:[{status:{$in:['uploading','uploaded','failed']}},{status:'processing',updatedAt:{$lt:new Date(Date.now()-30*60_000)}}]},{$set:{status:'processing',processingError:''}});
  if(!claim.modifiedCount)throw fail('PDF is already processing. Please wait.',409);
  t.status='processing';
  try{
    const questions=await extractQuestions(pdf);
    if(!questions.length)throw fail('No complete MCQs found in the PDF.');
    t.questions=questions;t.totalMarks=questions.length;t.status='ready';t.processingError='';
    await t.save();
    await deletePdfChunks(t.id).catch(error=>console.error('Chunk cleanup failed',error));
    return ok(publicTest(t));
  }catch(error){t.status='failed';t.processingError=error.message;await t.save();throw error}
}
if(action==='questions'&&method==='PATCH'){if(await Attempt.exists({testId:t.id}))throw fail('Questions cannot change after an attempt starts.');const indexes=z.array(z.number().int().nonnegative()).parse((await req.json()).removeIndexes);t.questions=t.questions.filter((_,i)=>!indexes.includes(i));t.totalMarks=t.questions.length;await t.save();return ok(publicTest(t))}
if(!action&&method==='GET')return ok(publicTest(t));if(!action&&method==='DELETE'){await Attempt.deleteMany({testId:t.id,userId:user.id});await deletePdfChunks(t.id);await t.deleteOne();return ok({deleted:true})}}
if(root==='attempts'&&id==='start'&&method==='POST'){const testId=z.object({testId:z.string()}).parse(await req.json()).testId;const t=await ownedTest(testId,user.id);if(t.status!=='ready'||!t.questions.length)throw fail('Test is not ready.');let a=await Attempt.findOne({testId:t.id,userId:user.id,status:'in_progress'});if(a&&new Date()>=a.expiresAt){await finish(a,t,true);a=null}if(!a)a=await Attempt.create({userId:user.id,testId:t.id,startedAt:new Date(),expiresAt:new Date(Date.now()+t.duration*60000)});return ok({attempt:attemptData(a),test:publicTest(t)})}
if(root==='attempts'&&id==='history'&&method==='GET'){const a=await Attempt.find({userId:user.id,status:{$ne:'in_progress'}}).populate('testId','title').sort({submittedAt:-1});return ok(a.map(x=>({id:x.id,title:x.testId?.title||'Deleted test',testId:x.testId?.id,score:x.score,maxMarks:x.correctCount+x.incorrectCount+x.unattemptedCount,accuracy:x.accuracy,timeTaken:x.timeTaken,submittedAt:x.submittedAt,status:x.status})))}
if(root==='attempts'&&id){const a=await ownedAttempt(id,user.id),t=await ownedTest(a.testId,user.id);if(a.status==='in_progress'&&new Date()>=a.expiresAt)await finish(a,t,true);if(!action&&method==='GET')return ok({attempt:attemptData(a),test:publicTest(t)});if(action==='answer'&&method==='PATCH'){if(a.status!=='in_progress')throw fail('Already submitted',409);const {index,answer}=z.object({index:z.number().int().nonnegative(),answer:z.string().nullable()}).parse(await req.json());if(index>=t.questions.length||answer!==null&&!t.questions[index].options.includes(answer))throw fail('Invalid answer');const key=`answers.${index}`;const update=answer===null?{$unset:{[key]:1},$addToSet:{visited:index}}:{$set:{[key]:answer},$addToSet:{visited:index}};const saved=await Attempt.findOneAndUpdate({_id:a.id,userId:user.id,status:'in_progress',expiresAt:{$gt:new Date()}},update,{returnDocument:'after'});if(!saved){const current=await ownedAttempt(id,user.id);if(current.status==='in_progress'&&new Date()>=current.expiresAt)await finish(current,t,true);throw fail('Time is up or the test was submitted.',409)}return ok(attemptData(saved))}if(action==='submit'&&method==='POST'){await finish(a,t,new Date()>=a.expiresAt);return ok({id:a.id,status:a.status})}if(action==='result'&&method==='GET'){if(a.status==='in_progress')throw fail('Submit the test first.',409);return ok({id:a.id,title:t.title,score:a.score,maxMarks:t.questions.length,attemptedCount:a.correctCount+a.incorrectCount,negativeMarks:Number((a.incorrectCount*0.25).toFixed(2)),correctCount:a.correctCount,incorrectCount:a.incorrectCount,unattemptedCount:a.unattemptedCount,accuracy:a.accuracy,timeTaken:a.timeTaken,status:a.status,submittedAt:a.submittedAt,review:t.questions.map((q,i)=>({question:q.question,options:q.options,selected:a.answers.get(String(i))||null,correctAnswer:q.correctAnswer,explanation:q.explanation,status:!a.answers.get(String(i))?'skipped':a.answers.get(String(i))===q.correctAnswer?'correct':'incorrect'}))})}}
if(root==='analytics'&&id==='dashboard'&&method==='GET'){const a=await Attempt.find({userId:user.id,status:{$ne:'in_progress'}}).populate('testId','title').sort({submittedAt:-1});const total=a.length,answered=a.reduce((v,x)=>v+x.correctCount+x.incorrectCount,0),correct=a.reduce((v,x)=>v+x.correctCount,0);const pct=x=>Math.round(x.score/(x.correctCount+x.incorrectCount+x.unattemptedCount||1)*100);return ok({totalTests:total,averageScore:total?Math.round(a.reduce((v,x)=>v+pct(x),0)/total):0,bestScore:total?Math.max(...a.map(pct)):0,overallAccuracy:answered?Math.round(correct/answered*100):0,trend:a.slice(0,10).reverse().map(x=>({date:new Date(x.submittedAt).toLocaleDateString(),score:pct(x)})),recent:a.slice(0,5).map(x=>({id:x.id,title:x.testId?.title||'Deleted test',score:x.score,maxMarks:x.correctCount+x.incorrectCount+x.unattemptedCount,accuracy:x.accuracy,submittedAt:x.submittedAt,status:x.status}))})}
throw fail('Not found',404)}catch(e){console.error(e);return Response.json({error:e instanceof ZodError?e.issues[0]?.message:e.message||'Server error'},{status:e.status|| (e instanceof ZodError?400:500)})}}
export const GET=handle,POST=handle,PUT=handle,PATCH=handle,DELETE=handle;
