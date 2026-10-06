import mongoose from 'mongoose'

import {collation} from '../db-tools.js'

// Products of the selection, frozen when the request is made
const RequestProduct = new mongoose.Schema({
	_product: {type: mongoose.Schema.ObjectId, ref: 'Product'},
	ref: String,
	title: String
}, {_id: false})

// The share of one tenant: its products, then its quote (private PDF) or its refusal
const RequestPart = new mongoose.Schema({
	_tenant: {type: mongoose.Schema.ObjectId, ref: 'Tenant', required: true},
	status: {type: String, default: 'pending'}, // pending | quoted | declined
	products: [RequestProduct],

	_media: {type: mongoose.Schema.ObjectId, ref: 'Media'},
	_answeredBy: {type: mongoose.Schema.ObjectId, ref: 'User'},
	answeredAt: Date
}, {_id: false})

// Quote request of a customer, made from his selection. Answered when every
// tenant has quoted or declined its part.
const Request = new mongoose.Schema({
	_customer: {type: mongoose.Schema.ObjectId, ref: 'Customer', required: true, index: true},
	status: {type: String, default: 'pending', index: true}, // pending | answered
	parts: [RequestPart],

	answeredAt: Date,
	createdAt: Date,
	updatedAt: Date
}, {
	collection: 'request',
	collation
})

Request.index({'parts._tenant': 1})

Request.pre('save', function(next){
	this.updatedAt = new Date()
	if(this.isNew && !this.createdAt) this.createdAt = new Date()

	next()
})

mongoose.model('Request', Request)
