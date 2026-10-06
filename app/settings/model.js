import mongoose from 'mongoose'

import {collation} from '../db-tools.js'

const Settings = new mongoose.Schema({
	slug: {type: String, index: true},

	// Brand (entity identity, editable in the dashboard)
	brandName: {type: String},
	brandShort: {type: String},

	mailCopy: [{type: String}],
	mailSubjectPrefix: {type: String},

	updatedAt: Date
}, {
	collection: 'settings',
	collation
})

Settings.pre('save', async function(next){
	this.updatedAt = new Date()
	next()
})

mongoose.model('Settings', Settings)
