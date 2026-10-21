import mongoose from 'mongoose'

import {syncPictures} from './pictures.js'

const Product = mongoose.model('Product')

// The Product of an item built from its raw answer: normalized fields, then
// pictures. Shared by the import (product job) and the rebuild (rebuild job).
// revive: the product comes back on the site (seen at its source again).
// → {isNew, changed, _product}
export async function buildProduct(source, item, adapter, raw, {revive=false}={}){
	const {picture, gallery, ...fields} = adapter.normalize(raw)

	let $product = item._product && await Product.findOne({_id: item._product})
	const isNew = !$product

	if(isNew) $product = new Product({source, externalId: item.externalId, _importItem: item._id})

	$product.set({...fields, _tenant: item._tenant, ...(revive ? {removedAt: undefined} : {})})

	// Mongoose leaves a path untouched when set to the same value
	const modified = isNew || $product.isModified()
	if(modified) await $product.save()

	const picturesChanged = await syncPictures(source, $product._id, {picture, gallery})

	return {isNew, changed: modified || picturesChanged, _product: $product._id}
}
