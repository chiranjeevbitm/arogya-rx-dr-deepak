import { handle } from 'hono/vercel'
import app from '../server/app.js'

const h = handle(app)
export const GET = h, POST = h, PUT = h, PATCH = h, DELETE = h, OPTIONS = h
