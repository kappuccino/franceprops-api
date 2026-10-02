import 'dotenv/config.js'
import {createServer} from 'http'
import express from 'express'
import helmet from 'helmet'
import bodyParser from 'body-parser'
import cookieParser from 'cookie-parser'
import morgan from 'morgan'
import cors from 'cors'
import {Server} from 'socket.io'

import {developmentErrors, productionErrors} from './request.js'
import {authQuery, authHeader, authCookie} from './server-middleware.js'
import socket from './socket.js'

// create our Express app
const app = express()
const httpServer = createServer(app)

// Socket
const io = new Server(httpServer, {
	// A brutally lost connection (wifi cut, laptop closed) is only noticed when a
	// ping goes unanswered — with the defaults, up to 45 s. Until then the socket
	// holds its co-edition zones and its document lock, and nobody else can edit.
	// ~25 s instead. Not lower: a 20 s network hole on mobile would disconnect
	// someone who is still sitting in front of the form.
	pingInterval: 15000,
	pingTimeout: 10000,

	cors: {
		origin: [
			process.env.DASH_URL
		],
		credentials: true
	}
})


// Keep this on top
app.use(helmet({
	crossOriginResourcePolicy: false
}))

app.use(morgan('dev', {
	skip: req => {
		if(req.url === '/favicon.ico' || req.method === 'OPTIONS') return true
	}
}))

app.use('/*splat', cors((req, callback) => {
	callback(null, {
		credentials: true,
		origin: req.get('origin')
	})
}))

app.use(function (req, res, next){
	const origin = req.get('origin')
	if(origin) res.header("Access-Control-Allow-Origin", req.get('origin'))

	//res.header("Access-Control-Allow-Credentials", true)
	res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization")
	res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, PUT, OPTIONS")
	res.header("X-Frame-Options", "GOFORIT");

	if('OPTIONS' === req.method) return res.sendStatus(200)

	next()
})

// No favicon !
app.get('/favicon.ico', (req, res) => res.status(204))

// Takes the raw requests and turns them into usable properties on req.body
app.use(bodyParser.json({type: 'application/*+json', limit: '20mb'}))
app.use(bodyParser.urlencoded({ extended: true }))

// Read cookies (needed for auth)
app.use(cookieParser())

// Auth check
app.use(authQuery)
app.use(authHeader)
app.use(authCookie)

app.get('/hello', (req, res) => {
	res.json({'hello': 'world'})
})

console.log('[•] Starting server')

Promise.all([
	import('./media/route.js'),
	import('./broadcast/route.js'),
	import('./mailjet/route.js'),
])
	.then(routes => {
		console.log('[•] Register routes')
		routes.forEach(r => app.use('/', r.default))
	})
	.then(() => {
		console.log('[•] Initialize GraphQL')
		return import('./_graphql/_server.js')
			.then(({boot}) => boot(app))
	})
	.then(() => {
		console.log('[•] Attach error handlers')
		app.get('env') === 'development'
			? app.use(developmentErrors) // prints stack trace
			: app.use(productionErrors)
	})
	.then(() => {
		console.log('[•] Starting socket.io')
		return socket(io)
	})
	.then(async () => {
		httpServer.listen(process.env.PORT, () => {
			console.log(`[λ] Express running → PORT ${process.env.PORT}`)
		})
	})
	.catch(err => {
		console.log('🔥', err)
	})
