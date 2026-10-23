import 'dotenv/config.js'
import mongoose from 'mongoose'

import './token/model.js'
import './user/model.js'
import './media/model.js'
import './template/model.js'
import './mail-queue/model.js'
import './settings/model.js'
import './version/model.js'
import './tenant/model.js'
import './customer/model.js'
import './product/model.js'
import './taxonomy/model.js'
import './selection/model.js'
import './request/model.js'
import './import/model.js'

mongoose.set('strictQuery', true)

mongoose.connect(process.env.MONGO, {
	family: 4,
	maxPoolSize: 10,
	maxIdleTimeMS: 60000,
	minPoolSize: 2,
	serverSelectionTimeoutMS: 5000,
	connectTimeoutMS: 10000
})

mongoose.connection.on('error', (err) => {
	console.error(`🚫 → ${err.message}`)
})

export const disconnect = mongoose.disconnect
