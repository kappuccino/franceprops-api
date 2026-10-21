import {createClient} from '../graphql-client.js'
import {contentHash} from '../hash.js'
import {pictures, pictureUrls} from './pictures.js'

// Defrise: the main /graphql endpoint of their api (no service endpoint there),
// with a dedicated user and a long lived token (getUserFromJWT { jwt(expiresIn) }).
// DEFRISE_API_URL is the GraphQL endpoint (…/graphql).
//
// Same selection as their website (webContext): products in stock with a
// picture, checked again here (webContext lets a null _picture through).
// Defrise deletes its products for good: a product missing from the listing
// is gone.

const PAGE = 200

const LIST = `query($params:ProductAggregateParams){
	aggregateProduct(params:$params webContext:true){
		total
		data{
			_id
			code
			stock
			_picture
			updated
			picture{url}
			gallery{order media{url}}
		}
	}
}`

// Catalogue fields only: purchase, storage, documents, prices… stay at Defrise
const PRODUCT = `query($_id:String!){
	getProductById(_id:$_id){
		_id
		code
		type
		titleFR
		titleEN
		titleERP
		shortTitleFR
		shortTitleEN
		descriptionFR
		descriptionEN
		condition
		workingCondition
		isFragile
		stock
		dimensions
		height
		length
		width
		diameter
		weight
		signature
		created
		updated
		_picture
		picture{_id url name width height ratio isPrivate}
		gallery{
			order
			main
			hidden
			media{_id url name width height ratio isPrivate titleFR captionFR}
		}
		categoriesPath{_id nameFR nameEN _parent}
		periodsTerms{_id nameFR nameEN}
		stylesTerms{_id nameFR nameEN}
		materialsTerms{_id nameFR nameEN}
		colorsTerms{_id nameFR nameEN}
		keywordsTerms{_id nameFR nameEN}
		universTerms{_id nameFR nameEN}
		subproducts{_product quantity}
	}
}`

function isPublished(product){
	return product.stock > 0 && !!product._picture
}

// Their taxonomy resolvers fail on a term deleted since (categoriesPath…): the
// product is imported anyway, without these terms
const TAXONOMIES = ['categoriesPath', 'periodsTerms', 'stylesTerms', 'materialsTerms', 'colorsTerms', 'keywordsTerms', 'universTerms']

function client(){
	return createClient({
		url: process.env.DEFRISE_API_URL,
		token: process.env.DEFRISE_API_TOKEN,
		tolerate: TAXONOMIES
	})
}

// Products of their website, one page at a time: [{externalId, hash, ref}]. The
// hash is the last save at Defrise (refreshed by every edit of the product) and
// the urls of its pictures (a cut-out keeps the product date).
export async function* list(){
	const query = client()

	for(let skip = 0; ; skip += PAGE){
		const {aggregateProduct} = await query(LIST, {
			params: {sort: {_id: 1}, limit: PAGE, skip}
		})

		const data = aggregateProduct?.data || []
		yield data
			.filter(isPublished)
			.map(product => ({externalId: product._id, hash: contentHash([product.updated, pictureUrls(product.picture, product.gallery)]), ref: product.code}))

		if(data.length < PAGE) break
	}
}

// Raw product, null when it no longer exists or left their website
export async function fetchProduct(externalId){
	const {getProductById: product} = await client()(PRODUCT, {_id: externalId})
	if(!product || !isPublished(product)) return null

	// Hidden and private photos are not for the site (403 for private ones)
	if(product.picture?.isPrivate) product.picture = null
	product.gallery = (product.gallery || []).filter(item => item.media && !item.hidden && !item.media.isPrivate)

	return product
}

// Catalogue fields taken from the raw product (more with the uniformisation)
export function normalize(raw){
	return {
		ref: raw.code || null, // reused or empty at some sources: a label only
		title: raw.titleFR || raw.shortTitleFR || raw.titleERP || raw.code,
		...pictures(raw.picture, raw.gallery)
	}
}
