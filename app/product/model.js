import mongoose from 'mongoose'

import {collation} from '../db-tools.js'

// A picture of an imported product (app/picture): the file of the source, and
// the stored copy. sourceUrl is the version wanted, storedFrom the one stored:
// while they differ, the stored version stays visible until the new one
// replaces it.
const Picture = new mongoose.Schema({
	sourceId: {type: String, required: true}, // id of the picture at the source
	sourceUrl: String,
	width: Number,
	height: Number,

	status: {type: String, enum: ['pending', 'stored', 'error'], default: 'pending'},
	error: String,

	hash: String, // of the stored content, in its storage key
	ext: String,
	storedFrom: String,
	storedAt: Date
}, {_id: false})

// Catalogue item, owned by a single tenant (imported from its source)
const Product = new mongoose.Schema({
	_tenant: {type: mongoose.Schema.ObjectId, ref: 'Tenant', required: true, index: true},
	ref: {type: String, trim: true}, // a label only: some sources reuse it or leave it empty
	title: {type: String, trim: true},

	// Imported product: its source and its id there (see app/import)
	source: {type: String, index: true},
	externalId: String,
	_importItem: {type: mongoose.Schema.ObjectId, ref: 'ImportItem', index: true},

	// Gone from its source: hidden on the site, still valid in the requests and
	// the selections. Cleared if the product comes back.
	removedAt: {type: Date, index: true},

	// The main picture, then the others in the order of the source
	picture: {type: Picture, default: null},
	gallery: {type: [Picture], default: []},
	picturesRev: {type: Number, default: 0}, // every write of the pictures, see app/import/pictures.js

	createdAt: Date,
	updatedAt: Date
}, {
	collection: 'product',
	collation
})

// Not unique: an imported product is identified by its source and its id there
// (ImportItem). Former unique index: scripts/migrate-product-ref-index.js
Product.index({_tenant: 1, ref: 1})

Product.pre('save', function(next){
	this.updatedAt = new Date()
	if(this.isNew && !this.createdAt) this.createdAt = new Date()

	next()
})

mongoose.model('Product', Product)
