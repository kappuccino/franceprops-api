import mongoose from 'mongoose'

import {collation} from '../db-tools.js'

const SelectionItem = new mongoose.Schema({
	_product: {type: mongoose.Schema.ObjectId, ref: 'Product', required: true},
	addedAt: Date
}, {_id: false})

// Products a website visitor keeps aside. Anonymous: reached by its random key
// (cookie of the visitor) and removed 30 days after its last change. Attached
// to a customer at login or signup: no key, no expiry.
const Selection = new mongoose.Schema({
	key: {type: String, index: {unique: true, sparse: true}},
	_customer: {type: mongoose.Schema.ObjectId, ref: 'Customer', index: {unique: true, sparse: true}},
	items: [SelectionItem],

	expireAt: {type: Date, expires: 0},
	createdAt: Date,
	updatedAt: Date
}, {
	collection: 'selection',
	collation
})

Selection.pre('save', function(next){
	this.updatedAt = new Date()
	if(this.isNew && !this.createdAt) this.createdAt = new Date()

	next()
})

mongoose.model('Selection', Selection)
