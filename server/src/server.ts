import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import authRouter, { requireAuth, type AuthRequest } from './auth.js'
import { prisma } from './db.js'
import { env } from './env.js'
import { AiServiceError, checkAiHealth, formatTutorResponse, generateTutorResponse } from './services/ai.service.js'
const app=express()
app.use(helmet())
app.use(cors({
 origin:(origin,callback)=>{
  const isLocalDevelopmentOrigin=env.NODE_ENV==='development'&&/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin||'')
  callback(null,!origin||origin===env.CLIENT_ORIGIN||isLocalDevelopmentOrigin)
 },
 credentials:true
}))
app.use(express.json({limit:'32kb'}))
app.use(cookieParser())
app.use('/api/v1/auth',rateLimit({windowMs:15*60*1000,limit:80,standardHeaders:true,legacyHeaders:false}),authRouter)
app.get('/api/v1/health',async(_req,res)=>{
 const ai=await checkAiHealth()
 const ready=ai.status==='ready'
 res.status(ready?200:503).json({status:ready?'ok':'degraded',service:'LinguaAI API',ai:{provider:env.AI_PROVIDER,...ai}})
})
app.use('/api/v1',requireAuth)
app.post('/api/v1/chat/sessions',async(req:AuthRequest,res)=>{
 const parsed=z.object({language:z.string().trim().min(1).max(40).default('English'),topic:z.string().trim().max(100).default('Free conversation')}).safeParse(req.body)
 if(!parsed.success){res.status(400).json({error:'Invalid session details.'});return}
 const session=await prisma.session.create({data:{userId:req.userId!,language:parsed.data.language,topic:parsed.data.topic}})
 res.status(201).json({data:{session}})
})
app.get('/api/v1/chat/sessions',async(req:AuthRequest,res)=>{
 const sessions=await prisma.session.findMany({where:{userId:req.userId!},orderBy:{createdAt:'desc'},take:50})
 res.json({data:{sessions}})
})
app.get('/api/v1/chat/sessions/:id',async(req:AuthRequest,res)=>{
 const session=await prisma.session.findFirst({where:{id:req.params.id,userId:req.userId!}})
 if(!session){res.status(404).json({error:'Session not found.'});return}
 const messages=await prisma.message.findMany({where:{sessionId:session.id},orderBy:{createdAt:'asc'}})
 res.json({data:{session,messages}})
})
const chatMessageLimiter=rateLimit({
 windowMs:60*1000,
 limit:20,
 standardHeaders:true,
 legacyHeaders:false,
 handler:(_req,res)=>res.status(429).json({error:'You are sending messages too quickly. Please wait a moment and try again.'})
})
app.post('/api/v1/chat/sessions/:id/messages',chatMessageLimiter,async(req:AuthRequest,res)=>{
 const parsed=z.object({content:z.string().trim().min(1).max(5000),inputType:z.enum(['text','voice']).default('text')}).safeParse(req.body)
 if(!parsed.success){res.status(400).json({error:'Message must contain 1–5000 characters.'});return}
 let stage:'load'|'generate'|'persist'='load'
 try{
  const session=await prisma.session.findFirst({where:{id:req.params.id,userId:req.userId!},include:{user:true}})
  if(!session){res.status(404).json({error:'Session not found.'});return}
  const prior=await prisma.message.findMany({where:{sessionId:session.id},orderBy:{createdAt:'desc'},take:12})
  const history=prior.reverse().flatMap((message):Array<{role:'user'|'assistant';content:string}>=>{
   if(message.role!=='user'&&message.role!=='assistant')return []
   return [{role:message.role,content:message.content}]
  })
  stage='generate'
  const tutor=await generateTutorResponse({
   targetLanguage:session.language||session.user.targetLanguage,
   level:session.user.level,
   nativeLanguage:session.user.nativeLanguage,
   topic:session.topic,
   history,
   message:parsed.data.content
  })
  stage='persist'
  const createdAt=new Date()
  const [userMessage,reply]=await prisma.$transaction(async tx=>{
   const userMessage=await tx.message.create({data:{sessionId:session.id,role:'user',content:parsed.data.content,inputType:parsed.data.inputType,createdAt}})
   const reply=await tx.message.create({data:{sessionId:session.id,role:'assistant',content:formatTutorResponse(tutor),createdAt:new Date(createdAt.getTime()+1)}})
   return [userMessage,reply] as const
  })
  res.json({data:{message:userMessage,reply,tutor}})
 }catch(error){
  if(error instanceof AiServiceError){
   console.error('Local AI request failed',{code:error.code,diagnostic:error.diagnostic})
   const messages:Record<AiServiceError['code'],{status:number;message:string}>={
    unavailable:{status:503,message:'The local AI tutor is offline. Check that Ollama is running, then try again.'},
    timeout:{status:504,message:'The local AI tutor took too long to respond. Please try a shorter message and try again.'},
    model_missing:{status:503,message:'The language model is not installed yet. Run the Ollama model setup and try again.'},
    invalid_response:{status:502,message:'The local AI tutor returned an invalid response. Please try again.'},
    upstream_error:{status:502,message:'The local AI tutor is temporarily unavailable. Please try again.'}
   }
   const failure=messages[error.code]
   res.status(failure.status).json({error:failure.message})
   return
  }
  console.error('Chat request failed',{stage,error:error instanceof Error?error.name:'unknown'})
  if(stage==='persist')res.status(500).json({error:'Could not save your message. Please try again.'})
  else res.status(500).json({error:'Could not process your message. Please try again.'})
 }
})
app.post('/api/v1/chat/sessions/:id/end',async(req:AuthRequest,res)=>{
 const result=await prisma.session.updateMany({where:{id:req.params.id,userId:req.userId!},data:{endedAt:new Date()}})
 if(!result.count){res.status(404).json({error:'Session not found.'});return}
 res.json({data:{success:true}})
})
app.get('/api/v1/progress/overview',async(req:AuthRequest,res)=>{
 const sessions=await prisma.session.findMany({where:{userId:req.userId!},include:{messages:true,evaluation:true}})
 const totalMessages=sessions.reduce((n,s)=>n+s.messages.filter(m=>m.role==='user').length,0)
 const evaluations=sessions.map(s=>s.evaluation).filter(Boolean) as NonNullable<typeof sessions[number]['evaluation']>[]
 const avg=(key:'grammarScore'|'vocabularyScore'|'fluencyScore'|'communicationScore')=>{const values=evaluations.map(e=>e[key]).filter((v):v is number=>v!==null);return values.length?Math.round(values.reduce((a,b)=>a+b,0)/values.length):null}
 const minutes=sessions.reduce((n,s)=>n+Math.max(1,Math.ceil(s.messages.length*0.7)),0)
 res.json({data:{sessions:sessions.length,totalMessages,practiceMinutes:minutes,averageScores:{grammar:avg('grammarScore'),vocabulary:avg('vocabularyScore'),fluency:avg('fluencyScore'),communication:avg('communicationScore')}}})
})
app.use((err:any,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{console.error(err);res.status(500).json({error:'Something went wrong. Please try again.'})})
app.listen(env.PORT,()=>console.log(`LinguaAI API listening on http://localhost:${env.PORT}`))
