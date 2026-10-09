import mongoose from 'mongoose'

import {collation} from '../db-tools.js'

// Products of the selection, frozen when the request is made
const RequestProduct = new mongoose.Schema({
	_product: {type: mongoose.Schema.ObjectId, ref: 'Product'},
	ref: String,
	title: String,
	quantity: {type: Number, default: 1}
}, {_id: false})

// Product kept by a revision with another quantity
const RequestChange = new mongoose.Schema({
	_product: {type: mongoose.Schema.ObjectId, ref: 'Product'},
	ref: String,
	title: String,
	from: Number,
	to: Number
}, {_id: false})

// The share of one tenant: its products, then its quote (private PDF) or its refusal
const RequestPart = new mongoose.Schema({
	_tenant: {type: mongoose.Schema.ObjectId, ref: 'Tenant', required: true},
	status: {type: String, default: 'pending'}, // pending | quoted | declined
	products: [RequestProduct],

	_media: {type: mongoose.Schema.ObjectId, ref: 'Media'},
	// Total of the quote (HT), typed by the tenant with its PDF
	amount: Number,
	_answeredBy: {type: mongoose.Schema.ObjectId, ref: 'User'},
	answeredAt: Date,

	// Revision: answer carried over from an earlier request (same products), or
	// what changed for this tenant since the previous request
	_carriedFrom: {type: mongoose.Schema.ObjectId, ref: 'Request'},
	added: [RequestProduct],
	removed: [RequestProduct],
	changed: [RequestChange]
}, {_id: false})

// Quote request of a customer, made from his selection. Answered when every
// tenant has quoted or declined its part. Revised: replaced by a newer request
// made from it (_previous of the new one).
const Request = new mongoose.Schema({
	// Number shown as #42, #42.1, #42.2…: a revision keeps the id of the first
	// request of its chain and increments revision (one level only)
	id: {type: Number, index: true},
	revision: {type: Number, default: 0},
	_customer: {type: mongoose.Schema.ObjectId, ref: 'Customer', required: true, index: true},
	// Name of the selection it was made from
	name: {type: String, trim: true},

	// Filled by the customer when sending the request
	project: {type: String, trim: true},
	company: {type: String, trim: true},
	billingAddress: {type: String, trim: true},
	delivery: {type: Boolean, default: false},
	deliveryAddress: {type: String, trim: true},
	startAt: Date,
	endAt: Date,
	comment: {type: String, trim: true},
	termsAcceptedAt: Date,

	_previous: {type: mongoose.Schema.ObjectId, ref: 'Request', index: true},
	// New request made from an earlier one (for information, nothing carried over)
	_source: {type: mongoose.Schema.ObjectId, ref: 'Request'},
	status: {type: String, default: 'pending', index: true}, // pending | answered | revised | accepted | refused
	parts: [RequestPart],

	answeredAt: Date,
	// The customer accepted or refused the quotes (status accepted | refused)
	decidedAt: Date,
	createdAt: Date,
	updatedAt: Date
}, {
	collection: 'request',
	collation
})

Request.index({'parts._tenant': 1})
Request.index({id: 1, revision: 1}, {unique: true, sparse: true})

Request.pre('save', async function(){
	this.updatedAt = new Date()
	if(this.isNew && !this.createdAt) this.createdAt = new Date()

	if(!this.id){
		const Model = mongoose.model('Request')
		const previous = this._previous && await Model.findById(this._previous, {id: 1}).lean()

		if(previous?.id){
			const last = await Model.findOne({id: previous.id}).sort({revision: -1}).lean()

			this.id = previous.id
			this.revision = (last?.revision || 0) + 1
		}else{
			const last = await Model.findOne({id: {$exists: true}}).sort({id: -1}).lean()

			this.id = last?.id > 0 ? last.id + 1 : 1
			this.revision = 0
		}
	}
})

mongoose.model('Request', Request)
