import {canAccessTenant, isAdmin, isService, unauthorized} from './_helper.js'
import * as productApi from '../product/product.js'
import * as tenantApi from '../tenant/tenant.js'

// --

const Product = `
  type Product {
    _id: String
    _tenant: String
    tenant: Tenant
    ref: String
    title: String

    source: String
    externalId: String
    removedAt: Date

    createdAt: Date
    updatedAt: Date
  }
`

const ProductSearch = `
  type ProductSearch {
    total: Int
    limit: Int
    skip: Int
    data: [Product]
  }
`

const ProductSearchParams = `
  input ProductSearchParams {
    _tenant: String
    limit: Int
    skip: Int
    sort: JSONObject
    search: String
  }
`

// --

export default {
	TypeDefs: [
		Product,
		ProductSearch,
		ProductSearchParams
	],

	//--

	Query: `
    searchProduct(params: ProductSearchParams!): ProductSearch
    getProductById(_id: String!): Product
	`,

	QueryResolvers: {
		// One tenant (dashboard), or the whole catalogue for admins and the website
		searchProduct: (obj, {params}, context) => {
			const allowed = params._tenant
				? canAccessTenant(context, params._tenant)
				: isAdmin(context) || isService(context)

			if(!allowed) unauthorized()

			// The website doesn't show the products gone from their source
			return productApi.aggregate({...params, hideRemoved: isService(context)})
		},

		// Same rights as the listing, checked on the tenant of the product
		getProductById: async (obj, {_id}, context) => {
			const product = await productApi.getById(_id)
			if(!product) return null

			if(!canAccessTenant(context, product._tenant.toString())) unauthorized()
			if(product.removedAt && isService(context)) return null

			return product
		},
	},

	//--

	Resolvers: {
		Product: {
			tenant: obj => obj._tenant ? tenantApi.getById(obj._tenant) : null,
		}
	},

	//--

	Mutation: ``,

	MutationResolvers: {},
}
