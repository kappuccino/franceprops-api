import {createClient} from '../graphql-client.js'
import {contentHash} from '../hash.js'

// Lanzani: the main /graphql endpoint of their api (no service endpoint there),
// with a dedicated user and a long lived token (getUserFromJWT { jwt(expiresIn) }).
// LANZANI_API_URL is the GraphQL endpoint (…/graphql).
//
// Same selection as their website (webContext): products visible on the web,
// with a picture. Lanzani deletes its products for good: a product missing
// from the listing is gone.
//
// Their "updated" is only set at the creation: the listing fetches the whole
// products and the hash is computed on their content.

const PAGE = 100

// Catalogue fields only: purchase, storage, prices… stay at Lanzani
const FIELDS = `
	_id
	code
	type
	webVisible
	titleFR
	titleEN
	titleERP
	descriptionFR
	descriptionEN
	condition
	workingCondition
	isFragile
	stock
	dimensions
	weight
	created
	_picture
	picture{_id url name width height ratio isPrivate}
	gallery{
		order
		media{_id url name width height ratio isPrivate titleFR captionFR}
	}
	categoriesPath{_id nameFR nameEN _parent}
	periodsTerms{_id nameFR nameEN}
	stylesTerms{_id nameFR nameEN}
	materialsTerms{_id nameFR nameEN}
	colorsTerms{_id nameFR nameEN}
	keywordsTerms{_id nameFR nameEN}
	subproducts{_product quantity}
`

// webContext goes in the params here (the argument is ignored by Lanzani)
const LIST = `query($params:ProductAggregateParams){
	aggregateProduct(params:$params){
		total
		data{${FIELDS}}
	}
}`

const PRODUCT = `query($_id:String!){
	getProductById(_id:$_id){${FIELDS}}
}`

// Their webContext rule, checked again here (a null _picture would pass it)
function isPublished(product){
	return !!product.webVisible && !!product._picture
}

// Their taxonomy resolvers fail on a term deleted since (categoriesPath…): the
// product is imported anyway, without these terms
const TAXONOMIES = ['categoriesPath', 'periodsTerms', 'stylesTerms', 'materialsTerms', 'colorsTerms', 'keywordsTerms', 'universTerms']

function client(){
	return createClient({
		url: process.env.LANZANI_API_URL,
		token: process.env.LANZANI_API_TOKEN,
		tolerate: TAXONOMIES
	})
}

// Products of their website, one page at a time: [{externalId, hash, ref}]
export async function* list(){
	const query = client()

	for(let skip = 0; ; skip += PAGE){
		const {aggregateProduct} = await query(LIST, {
			params: {webContext: true, sort: {_id: 1}, limit: PAGE, skip}
		})

		const data = aggregateProduct?.data || []
		yield data
			.filter(isPublished)
			.map(product => ({externalId: product._id, hash: contentHash(product), ref: product.code}))

		if(data.length < PAGE) break
	}
}

// Raw product, null when it no longer exists or left their website
export async function fetchProduct(externalId){
	const {getProductById: product} = await client()(PRODUCT, {_id: externalId})
	if(!product || !isPublished(product)) return null

	// Private photos would answer 403 to the site
	if(product.picture?.isPrivate) product.picture = null
	product.gallery = (product.gallery || []).filter(item => item.media && !item.media.isPrivate)

	return product
}

// Catalogue fields taken from the raw product (more with the uniformisation)
export function normalize(raw){
	return {
		ref: raw.code || null, // reused or empty at some sources: a label only
		title: raw.titleFR || raw.titleERP || raw.code
	}
}
