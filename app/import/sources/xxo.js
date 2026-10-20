import {createClient} from '../graphql-client.js'

// XXO: the /graphql_web endpoint of their api, reserved to the "service"
// accounts (10 years token minted on their dashboard, /token page).
// XXO_API_URL is the GraphQL endpoint (…/graphql_web).
//
// Only the published products of type "product" (not the associated refs,
// "element") with a rental price are imported. XXO deletes its products for
// good: a product missing from the listing is gone.

const PAGE = 200

const LIST = `query($params:ProductAggregateParams){
	aggregateProduct(params:$params){
		total
		data{
			_id
			ref
			type
			status
			priceRental
			updated
		}
	}
}`

// Catalogue fields only: owners, invoices, storage, notes, sale price… stay at XXO
const PRODUCT = `query($_id:String!){
	getProductById(_id:$_id){
		_id
		ref
		type
		status
		title
		titleFR
		modelName
		year
		length
		width
		height
		heightSeat
		weight
		stock
		priceRental
		created
		updated
		categoryA{_id nameFR nameEN}
		categoryB{_id nameFR nameEN _parent}
		creator{_id fullName}
		editor{_id name}
		periodsTerms{_id nameFR nameEN}
		materialsTerms{_id nameFR nameEN}
		colorsTerms{_id nameFR nameEN}
		gallery{
			order
			main
			media{_id url name width height ratio isPrivate titleFR captionFR}
		}
		subproducts{_product quantity}
	}
}`

// Filtered by the listing already, checked again on the detail
function isPublished(product){
	return product.status === 'publish' && product.type === 'product' && product.priceRental > 0
}

function client(){
	return createClient({
		url: process.env.XXO_API_URL,
		token: process.env.XXO_API_TOKEN
	})
}

// Published products, one page at a time: [{externalId, hash, ref}]. The hash
// is the last save on XXO (refreshed by every edit of the product).
export async function* list(){
	const query = client()

	for(let skip = 0; ; skip += PAGE){
		const {aggregateProduct} = await query(LIST, {
			params: {status: 'publish', type: 'product', priceComparator: 'gt', priceValue: 0, sort: {_id: 1}, limit: PAGE, skip}
		})

		const data = aggregateProduct?.data || []
		yield data
			.filter(isPublished)
			.map(product => ({externalId: product._id, hash: product.updated, ref: product.ref}))

		if(data.length < PAGE) break
	}
}

// Raw product, null when it no longer exists or no longer matches the selection
export async function fetchProduct(externalId){
	const {getProductById: product} = await client()(PRODUCT, {_id: externalId})
	if(!product || !isPublished(product)) return null

	// Private photos would answer 403 to the site
	product.gallery = (product.gallery || []).filter(item => item.media && !item.media.isPrivate)

	return product
}

// Catalogue fields taken from the raw product (more with the uniformisation).
// title: the XXO label (ref, object, model, creator, editor, colors) without
// its leading ref, shown apart on the site. titleFR is most often empty.
export function normalize(raw){
	const label = raw.title?.startsWith(`${raw.ref} `) ? raw.title.slice(raw.ref.length + 1) : raw.title

	return {
		ref: raw.ref,
		title: label || raw.titleFR || raw.modelName || raw.ref
	}
}
