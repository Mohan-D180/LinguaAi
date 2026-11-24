import { Router, Request, Response, NextFunction } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import { z } from 'zod'
import { prisma } from './db.js'
import { env } from './env.js'
export type AuthRequest = Request & { userId?: string }
const router = Router()
const publicUser = (u:any) => ({id:u.id,name:u.name,email:u.email,nativeLanguage:u.nativeLanguage,targetLanguage:u.targetLanguage,level:u.level})
const accessToken = (id:string) => jwt.sign({sub:id},env.JWT_ACCESS_SECRET,{expiresIn:'15m'})
const refreshToken = (id:string) => jwt.sign({sub:id,jti:crypto.randomUUID()},env.JWT_REFRESH_SECRET,{expiresIn:'7d'})
const hash = (v:string) => crypto.createHash('sha256').update(v).digest('hex')
function setRefresh(res:Response, token:string){res.cookie('lingua_refresh',token,{httpOnly:true,secure:env.NODE_ENV==='production',sameSite:'lax',path:'/api/v1/auth',maxAge:7*24*60*60*1000})}
async function issueSession(userId:string,res:Response){
 const token=refreshToken(userId)
 const decoded=jwt.decode(token) as any
 await prisma.refreshToken.create({data:{userId,tokenHash:hash(token),expiresAt:new Date(decoded.exp*1000)}})
 setRefresh(res,token)
 return accessToken(userId)
}
export async function requireAuth(req:AuthRequest,res:Response,next:NextFunction){
 const header=req.headers.authorization
 const token=header?.startsWith('Bearer ')?header.slice(7):undefined
 if(!token){res.status(401).json({error:'Please sign in to continue.'});return}
 try{const payload=jwt.verify(token,env.JWT_ACCESS_SECRET) as any;req.userId=payload.sub;next()}
 catch{res.status(401).json({error:'Your session has expired. Please sign in again.'})}
}
const registerSchema=z.object({name:z.string().trim().min(2).max(80),email:z.string().email().max(254),password:z.string().min(8).max(72),nativeLanguage:z.string().max(40).default('Bengali'),targetLanguage:z.string().max(40).default('English'),level:z.enum(['A1','A2','B1','B2','C1']).default('A2')})
router.post('/register',async(req,res)=>{
 const parsed=registerSchema.safeParse(req.body);if(!parsed.success){res.status(400).json({error:'Please check your registration details.'});return}
 const {name,email,password,nativeLanguage,targetLanguage,level}=parsed.data
 try{const user=await prisma.user.create({data:{name,email:email.toLowerCase(),passwordHash:await bcrypt.hash(password,12),nativeLanguage,targetLanguage,level}})
 const token=await issueSession(user.id,res);res.status(201).json({data:{user:publicUser(user),accessToken:token}})
 }catch(e:any){if(e.code==='P2002'){res.status(409).json({error:'An account with this email already exists.'});return}res.status(500).json({error:'Could not create your account.'})}
})
router.post('/login',async(req,res)=>{
 const parsed=z.object({email:z.string().email(),password:z.string().min(1)}).safeParse(req.body);if(!parsed.success){res.status(400).json({error:'Enter a valid email and password.'});return}
 const user=await prisma.user.findUnique({where:{email:parsed.data.email.toLowerCase()}})
 if(!user||!(await bcrypt.compare(parsed.data.password,user.passwordHash))){res.status(401).json({error:'Email or password is incorrect.'});return}
 const token=await issueSession(user.id,res);res.json({data:{user:publicUser(user),accessToken:token}})
})
router.post('/refresh',async(req,res)=>{
 const token=req.cookies?.lingua_refresh
 if(!token){res.status(401).json({error:'Refresh session not found.'});return}
 try{
  const payload=jwt.verify(token,env.JWT_REFRESH_SECRET) as any
  const old=await prisma.refreshToken.findUnique({where:{tokenHash:hash(token)}})
  if(!old||old.revokedAt||old.expiresAt<new Date()){res.status(401).json({error:'Refresh session expired.'});return}
  await prisma.refreshToken.update({where:{id:old.id},data:{revokedAt:new Date()}})
  const newAccess=await issueSession(payload.sub,res)
  res.json({data:{accessToken:newAccess}})
 }catch{res.status(401).json({error:'Refresh session invalid.'})}
})
router.post('/logout',async(req,res)=>{
 const token=req.cookies?.lingua_refresh
 if(token){await prisma.refreshToken.updateMany({where:{tokenHash:hash(token),revokedAt:null},data:{revokedAt:new Date()}})}
 res.clearCookie('lingua_refresh',{httpOnly:true,secure:env.NODE_ENV==='production',sameSite:'lax',path:'/api/v1/auth'})
 res.json({data:{success:true}})
})
router.get('/me',requireAuth,async(req:AuthRequest,res)=>{
 const user=await prisma.user.findUnique({where:{id:req.userId!}})
 if(!user){res.status(404).json({error:'User not found.'});return}
 res.json({data:{user:publicUser(user)}})
})
export default router
