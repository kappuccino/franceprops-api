import mongoose from 'mongoose'

import {sourceKeys} from './sources/index.js'

// No collation on these collections: the ids of the sources are compared as
// they are (a case insensitive match could merge two distinct products)

// A product of a source, updated by every import. Keeps the raw answer of the
// source: the normalization can be replayed without fetching it again.
const ImportItem = new mongoose.Schema({
	source: {type: String, enum: sourceKeys, required: true},
	externalId: {type: String, required: true}, // id of the product at the source
	_tenant: {type: mongoose.Schema.ObjectId, ref: 'Tenant', index: true},

	ref: String, // as listed, to find the item before its first import
	hash: String, // fingerprint given by the source, unchanged → nothing to do
	raw: mongoose.Schema.Types.Mixed,

	status: {type: String, enum: ['pending', 'imported', 'unchanged', 'error', 'gone'], default: 'pending', index: true},
	error: String,

	listedAt: Date, // last listing it was part of (older than a run: gone)
	importedAt: Date,
	_product: {type: mongoose.Schema.ObjectId, ref: 'Product'},

	createdAt: Date,
	updatedAt: Date
}, {
	collection: 'import-item',
	minimize: false
})

ImportItem.index({source: 1, externalId: 1}, {unique: true})
ImportItem.index({source: 1, listedAt: 1})

ImportItem.pre('save', function(next){
	this.updatedAt = new Date()
	if(this.isNew && !this.createdAt) this.createdAt = new Date()

	next()
})

// A run of an import (start → every product job processed): its history,
// which Redis doesn't keep
const ImportRun = new mongoose.Schema({
	source: {type: String, enum: sourceKeys, required: true, index: true},
	status: {type: String, enum: ['listing', 'running', 'done', 'failed', 'reset'], default: 'listing', index: true},

	startedAt: Date,
	listedAt: Date, // end of the listing
	finishedAt: Date,

	// $inc by the product jobs, the run is done when they reach total
	total: {type: Number, default: 0},
	created: {type: Number, default: 0},
	updated: {type: Number, default: 0},
	unchanged: {type: Number, default: 0},
	failed: {type: Number, default: 0},
	gone: {type: Number, default: 0},

	error: String // the listing failed
}, {
	collection: 'import-run'
})

ImportRun.index({source: 1, startedAt: -1})

mongoose.model('ImportItem', ImportItem)
mongoose.model('ImportRun', ImportRun)
