import {canAccessTenant, genFailedMutation, getMedia, getUser, isAdmin, isService, unauthorized} from './_helper.js'
import * as requestApi from '../request/request.js'
import * as customerApi from '../customer/customer.js'
import * as tenantApi from '../tenant/tenant.js'

// Quote requests. Dashboard: a manager reaches the requests and the parts of
// his tenants only, admins reach everything. Website (@service): the customer
// of the session token.

const Request = `
  type Request {
    _id: String
    status: String
    _customer: String
    customer: Customer
    parts: [RequestPart]
    count: Int
    answeredAt: Date
    createdAt: Date
    updatedAt: Date
  }
`

const RequestPart = `
  type RequestPart {
    _tenant: String
    tenant: Tenant
    status: String
    products: [RequestProduct]
    _media: String
    media: Media
    _answeredBy: String
    answeredBy: User
    answeredAt: Date
  }
`

const RequestProduct = `
  type RequestProduct {
    _product: String
    ref: String
    title: String
  }
`

const RequestSearch = `
  type RequestSearch {
    total: Int
    limit: Int
    skip: Int
    data: [Request]
  }
`

const RequestSearchParams = `
  input RequestSearchParams {
    _tenant: String
    status: String
    limit: Int
    skip: Int
    sort: JSONObject
  }
`

const RequestMutation = `
  type RequestMutation{
    success: Boolean
    message: String
		stack: [String]
    request: Request
  }
`

// Parts the caller may see
function visibleParts(request, context){
	if(isAdmin(context) || isService(context)) return request.parts || []
	return (request.parts || []).filter(p => canAccessTenant(context, p._tenant.toString()))
}

// A request is reachable when at least one of its parts is
function canAccessRequest(request, context){
	return Boolean(request) && visibleParts(request, context).length > 0
}

// --

export default {
	TypeDefs: [
		Request,
		RequestPart,
		RequestProduct,
		RequestSearch,
		RequestSearchParams,

		RequestMutation
	],

	//--

	Query: `
    searchRequest(params: RequestSearchParams): RequestSearch
    getRequestById(_id: String!): Request

    siteRequests(token: String!): [Request] @service
    siteRequest(token: String! _id: String!): Request @service
	`,

	QueryResolvers: {
		// One tenant (managers), or every request for admins
		searchRequest: (obj, {params={}}, context) => {
			const allowed = params._tenant ? canAccessTenant(context, params._tenant) : isAdmin(context)
			if(!allowed) unauthorized()

			return requestApi.aggregate(params)
		},

		getRequestById: async (obj, {_id}, context) => {
			const request = await requestApi.getById(_id)
			if(!request) return null

			if(!canAccessRequest(request, context)) unauthorized()
			return request
		},

		siteRequests: (obj, {token}) => requestApi.listForCustomer(token),
		siteRequest: (obj, {token, _id}) => requestApi.getForCustomer(token, _id),
	},

	//--

	Resolvers: {
		Request: {
			customer: obj => customerApi.getById(obj._customer),
			parts: (obj, args, context) => visibleParts(obj, context),
			count: (obj, args, context) => visibleParts(obj, context).reduce((acc, p) => acc + (p.products?.length || 0), 0),
		},

		RequestPart: {
			tenant: obj => tenantApi.getById(obj._tenant),
			media: obj => obj._media ? getMedia(obj._media) : null,
			answeredBy: obj => obj._answeredBy ? getUser(obj._answeredBy) : null,
		},
	},

	//--

	Mutation: `
		answerRequest(_id: String! _tenant: String! status: String! _media: String): RequestMutation

		siteRequestCreate(token: String!): RequestMutation @service
	`,

	MutationResolvers: {
		// quoted (with the PDF) or declined, by a manager of the tenant or an admin
		answerRequest: async (obj, {_id, _tenant, status, _media}, context) => {
			try {
				if(!canAccessTenant(context, _tenant)) unauthorized()

				const request = await requestApi.answer(_id, _tenant, status, _media, context.user)
				return {success: true, request}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},

		// Website: the selection of the customer becomes a quote request
		siteRequestCreate: async (obj, {token}, context) => {
			try {
				const request = await requestApi.createFromSelection(token)
				return {success: true, request}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},
	}
}
