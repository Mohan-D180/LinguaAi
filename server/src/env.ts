import 'dotenv/config'
import { z } from 'zod'
const schema = z.object({
  PORT:z.coerce.number().default(4000),
  NODE_ENV:z.enum(['development','test','production']).default('development'),
  CLIENT_ORIGIN:z.string().default('http://localhost:5173'),
  DATABASE_URL:z.string().min(1),
  JWT_ACCESS_SECRET:z.string().min(32),
  JWT_REFRESH_SECRET:z.string().min(32),
  AI_PROVIDER:z.literal('ollama').default('ollama'),
  OLLAMA_BASE_URL:z.string().url().default('http://localhost:11434'),
  OLLAMA_MODEL:z.string().min(1).max(120).default('llama3.2:3b'),
  OLLAMA_TIMEOUT_MS:z.coerce.number().int().min(1000).max(600000).default(180000)
})
export const env = schema.parse(process.env)
