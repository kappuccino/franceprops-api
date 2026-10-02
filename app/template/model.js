import mongoose from 'mongoose'

import {collation} from '../db-tools.js'

const Template = new mongoose.Schema({
	slug: {type: String},
	name: {type: String},

	title: {type: String},
	content: {type: String},

	created: Date,
	updated: Date
}, {
	collection: 'template',
	collation
})

Template.pre('save', async function(next){

	this.updated = new Date()
	if(this.isNew && !this.created) this.created = new Date()

	next()
})

mongoose.model('Template', Template)
