import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {z} from 'zod';
import {generateGemini} from './gemini.js';

const Question=z.object({
  question:z.string().min(8),
  options:z.array(z.string().min(1)).min(2).max(6),
  correctAnswer:z.string().min(1),
  explanation:z.string().default(''),
  sourcePage:z.coerce.number().int().positive(),
  confidence:z.coerce.number().min(0).max(1),
  needsReview:z.boolean()
});
const Questions=z.object({questions:z.array(Question)});
const OcrPages=z.object({pages:z.array(z.object({page:z.coerce.number().int().positive(),text:z.string()}))});
const ocrSchema={type:'OBJECT',properties:{pages:{type:'ARRAY',items:{type:'OBJECT',properties:{page:{type:'INTEGER'},text:{type:'STRING'}},required:['page','text']}}},required:['pages']};
const questionSchema={type:'OBJECT',properties:{questions:{type:'ARRAY',items:{type:'OBJECT',properties:{question:{type:'STRING'},options:{type:'ARRAY',items:{type:'STRING'}},correctAnswer:{type:'STRING'},explanation:{type:'STRING'},sourcePage:{type:'INTEGER'},confidence:{type:'NUMBER'},needsReview:{type:'BOOLEAN'}},required:['question','options','correctAnswer','explanation','sourcePage','confidence','needsReview']}}},required:['questions']};
const normalize=s=>s.trim().replace(/\s+/g,' ').toLowerCase();
const withoutLabel=s=>s.replace(/^\s*(?:option\s*)?[A-F]\s*[).:\-]\s*/i,'').trim();
export function matchCorrectAnswer(options,answer){
  const raw=answer.trim();
  const exact=options.find(option=>normalize(option)===normalize(raw));
  if(exact)return exact;
  const letter=raw.match(/^\s*(?:option\s*)?([A-F])(?:\s*[).:\-]\s*|\s*$)/i);
  if(letter){const index=letter[1].toUpperCase().charCodeAt(0)-65;return options[index]||null}
  const text=normalize(withoutLabel(raw));
  return options.find(option=>normalize(withoutLabel(option))===text)||null;
}

async function readPdfPages(buffer){
  // Load PDF.js from its installed file so Next does not rewrite its worker path.
  const dir=path.join(process.cwd(),'node_modules','pdfjs-dist','legacy','build');
  const pdf=await (new Function('specifier','return import(specifier)'))(pathToFileURL(path.join(dir,'pdf.mjs')).href);
  pdf.GlobalWorkerOptions.workerSrc=pathToFileURL(path.join(dir,'pdf.worker.mjs')).href;
  const task=pdf.getDocument({data:new Uint8Array(buffer),useSystemFonts:true});
  const doc=await task.promise;
  const pages=[];const scanned=[];
  try{
    for(let number=1;number<=doc.numPages;number++){
      const content=await(await doc.getPage(number)).getTextContent();
      const text=content.items.map(item=>item.str).join(' ').trim();
      if(text.length<35)scanned.push(number);
      else pages.push({page:number,text});
    }
  }finally{await task.destroy()}
  return {pages,scanned};
}

export async function extractQuestions(buffer){
  const {pages,scanned}=await readPdfPages(buffer);
  const model=process.env.GEMINI_MODEL||'gemini-3.5-flash-lite';
  if(scanned.length){
    const response=await generateGemini({model,contents:[
      {text:`OCR fallback: transcribe text from only PDF pages ${scanned.join(', ')}. Preserve wording and page numbers. Return JSON pages array. Do not solve questions yet.`},
      {inlineData:{mimeType:'application/pdf',data:buffer.toString('base64')}}
    ],config:{responseMimeType:'application/json',responseSchema:ocrSchema}});
    const ocr=OcrPages.parse(JSON.parse(response.text));
    pages.push(...ocr.pages.filter(item=>scanned.includes(item.page)&&item.text.trim()));
  }
  pages.sort((a,b)=>a.page-b.page);
  if(!pages.length)throw new Error('No readable text was found in the PDF.');
  const chunks=[];let chunk='';
  for(const page of pages){
    const part=`\n[PAGE ${page.page}]\n${page.text}`;
    if(chunk.length+part.length>15000&&chunk){chunks.push(chunk);chunk=''}
    chunk+=part;
  }
  if(chunk)chunks.push(chunk);
  const questions=[];let extracted=0;
  for(const text of chunks){
    const response=await generateGemini({model,contents:`Extract only complete original multiple choice questions and their original options from the PDF text. Keep question and option wording intact. Never invent questions or options. Use the answer key if present, including answer keys on later pages. For correctAnswer, return the full option string exactly as provided in options when possible. If no answer key exists, solve carefully and set needsReview true when uncertain. Return JSON object with questions array. sourcePage must match a page marker.\n${text}`,config:{responseMimeType:'application/json',responseSchema:questionSchema}});
    const items=Questions.parse(JSON.parse(response.text)).questions;
    extracted+=items.length;
    for(const item of items){
      const matched=matchCorrectAnswer(item.options,item.correctAnswer);
      if(matched)questions.push({...item,correctAnswer:matched});
    }
  }
  if(extracted&&questions.length===0)throw new Error(`Gemini found ${extracted} questions, but their answers could not be matched to the options.`);
  const seen=new Set();
  return questions.filter(item=>{const key=normalize(item.question);if(seen.has(key))return false;seen.add(key);return true});
}
