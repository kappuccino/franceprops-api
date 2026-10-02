import mongoose from 'mongoose'

import {collation} from '../db-tools.js'

const Properties = mongoose.Schema({
	key: {type: String},
	value: {type: mongoose.Schema.Types.Mixed}
})

const Meta = mongoose.Schema({
	key: {type: String},
	value: {type: mongoose.Schema.Types.Mixed}
})

const Media = mongoose.Schema({
	name: {type: String},
	status: {type: String},
	url: {type: String},
	properties: {type: [Properties]},
	meta: {type: [Meta]},
	type: {type: String},
	mime: {type: String},

	titleFR: {type: String},
	titleEN: {type: String},
	captionFR: {type: String},
	captionEN: {type: String},

	created: Date,
	updated: Date
}, {
	collection: 'media',
	collation
})

Media.pre('save', function (next) {
	this.updated = new Date()
	if (this.isNew && !this.created) this.created = new Date()

	next()
})

mongoose.model('Media', Media)
