import {GoogleGenAI} from '@google/genai';

let primaryCooldownUntil=0;
let modelCooldownUntil=0;
const code=error=>Number(error?.status||error?.code||(()=>{try{return JSON.parse(error.message)?.error?.code}catch{return 0}})());
const quota=error=>code(error)===429||/RESOURCE_EXHAUSTED|quota exceeded|rate limit/i.test(error?.message||'');
const unavailable=error=>code(error)===503||/UNAVAILABLE|high demand|timeout|ETIMEDOUT/i.test(error?.message||'');
const call=(key,request)=>new GoogleGenAI({apiKey:key,httpOptions:{timeout:45000,retryOptions:{attempts:1}}}).models.generateContent(request);

export async function generateGemini(request){
  const primary=process.env.GEMINI_API_KEY?.trim();
  const fallback=process.env.GEMINI_API_KEY_FALLBACK?.trim();
  if(!primary)throw new Error('GEMINI_API_KEY is missing. Add it to .env.local.');
  const key=Date.now()<primaryCooldownUntil&&fallback&&fallback!==primary?fallback:primary;
  const model=Date.now()<modelCooldownUntil&&request.model==='gemini-3.5-flash-lite'?'gemini-3.1-flash-lite':request.model;
  const current={...request,model};
  try{return await call(key,current)}
  catch(error){
    if(quota(error)){
      if(key===primary)primaryCooldownUntil=Date.now()+60_000;
      if(key===primary&&fallback&&fallback!==primary){
        try{return await call(fallback,current)}catch(second){if(!quota(second)&&!unavailable(second))throw second}
      }
      throw new Error('Gemini quota reached. Please wait and retry, or add a fallback key from a different Google Cloud project.');
    }
    if(unavailable(error)&&model==='gemini-3.5-flash-lite'){
      modelCooldownUntil=Date.now()+60_000;
      try{return await call(key,{...request,model:'gemini-3.1-flash-lite'})}
      catch(second){if(!unavailable(second)&&!quota(second))throw second}
      throw new Error('Gemini is temporarily busy. The fallback model also failed. Open this test and retry later.');
    }
    if(unavailable(error))throw new Error('Gemini is temporarily busy. Open this test and retry later.');
    throw error;
  }
}
