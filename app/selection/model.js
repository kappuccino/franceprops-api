import mongoose from 'mongoose'

import {collation} from '../db-tools.js'

const SelectionItem = new mongoose.Schema({
	_product: {type: mongoose.Schema.ObjectId, ref: 'Product', required: true},
	quantity: {type: Number, default: 1, min: 1},
	addedAt: Date
}, {_id: false})

// Products a website visitor keeps aside ("panier"). Anonymous: a single one,
// reached by its random key (cookie of the visitor) and removed 30 days after
// its last change. A customer has as many as he wants, one of them active
// (Customer._selection): no key, no expiry.
const Selection = new mongoose.Schema({
	key: {type: String, index: {unique: true, sparse: true}},
	_customer: {type: mongoose.Schema.ObjectId, ref: 'Customer', index: true},
	name: {type: String, trim: true},
	items: [SelectionItem],

	// Rental period, the next request gets it
	startAt: Date,
	endAt: Date,

	// Answered request being revised: the next request revises it
	_request: {type: mongoose.Schema.ObjectId, ref: 'Request'},
	// Request the selection was copied from: the next request is a new one
	_source: {type: mongoose.Schema.ObjectId, ref: 'Request'},

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
