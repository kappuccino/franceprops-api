import mongoose from 'mongoose'

import {collation} from '../db-tools.js'

const VersionItem = new mongoose.Schema({
	createdAt: Date,
	data: {type: mongoose.Schema.Types.Mixed}
})

const Version = new mongoose.Schema({
	_source: {type: mongoose.Schema.ObjectId, index: true}, // Ref could be anything
	source: String,
	versions: [VersionItem],
}, {
	collection: 'version',
	collation
})

mongoose.model('Version', Version)
