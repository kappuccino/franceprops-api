import mongoose from 'mongoose'

import {collation} from '../db-tools.js'

// Terms of every taxonomy, shared by the whole catalogue: `taxonomy` is the
// slug (category: two levels, generic: flat), `_parent` the parent term
const Taxonomy = new mongoose.Schema({
	taxonomy: {type: String, required: true, index: true},
	_parent: {type: mongoose.Schema.ObjectId, ref: 'Taxonomy', index: true},
	order: {type: Number, default: 0},

	nameFR: {type: String, trim: true},
	nameEN: {type: String, trim: true},

	created: Date,
	updated: Date
}, {
	collection: 'taxonomy',
	collation
})

Taxonomy.pre('save', function(next){
	this.updated = new Date()
	if(this.isNew && !this.created) this.created = new Date()

	next()
})

mongoose.model('Taxonomy', Taxonomy)
