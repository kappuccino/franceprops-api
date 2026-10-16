import {canAccessTenant, genFailedMutation, getMedia, getUser, isAdmin, isService, unauthorized} from './_helper.js'
import * as requestApi from '../request/request.js'
import * as customerApi from '../customer/customer.js'
import * as tenantApi from '../tenant/tenant.js'
import {requestNumber} from '../request/number.js'

// Quote requests. Dashboard: a manager reaches the requests and the parts of
// his tenants only, admins reach everything. Website (@service): the customer
// of the session token.

const Request = `
  type Request {
    _id: String
    id: Int
    revision: Int
    # "42", or "42.1" for a revision
    number: String
    name: String
    project: String
    company: String
    billingAddress: String
    delivery: Boolean
    deliveryAddress: String
    startAt: Date
    endAt: Date
    comment: String
    termsAcceptedAt: Date
    status: String
    _previous: String
    previous: Request
    _source: String
    source: Request
    _customer: String
    customer: Customer
    parts: [RequestPart]
    count: Int
    answeredAt: Date
    decidedAt: Date
    # Quoted parts (the visible ones), null when none is quoted
    totalHT: Float
    vat: Float
    totalTTC: Float
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
    amount: Float
    _answeredBy: String
    answeredBy: User
    answeredAt: Date
    _carriedFrom: String
    added: [RequestProduct]
    removed: [RequestProduct]
    changed: [RequestChange]
  }
`

const RequestProduct = `
  type RequestProduct {
    _product: String
    ref: String
    title: String
    quantity: Int
  }
`

const RequestChange = `
  type RequestChange {
    _product: String
    ref: String
    title: String
    from: Int
    to: Int
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
    partStatus: String
    limit: Int
    skip: Int
    sort: JSONObject
  }
`

const RequestInfoInput = `
  input RequestInfoInput {
    project: String
    company: String
    billingAddress: String
    delivery: Boolean
    deliveryAddress: String
    comment: String
    terms: Boolean
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
		RequestChange,
		RequestSearch,
		RequestSearchParams,
		RequestInfoInput,

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
			number: obj => requestNumber(obj),
			customer: obj => customerApi.getById(obj._customer),
			previous: obj => obj._previous ? requestApi.getById(obj._previous) : null,
			source: obj => obj._source ? requestApi.getById(obj._source) : null,
			parts: (obj, args, context) => visibleParts(obj, context),
			count: (obj, args, context) => visibleParts(obj, context).reduce((acc, p) => acc + (p.products?.length || 0), 0),
			totalHT: (obj, args, context) => requestApi.totals(visibleParts(obj, context))?.totalHT ?? null,
			vat: (obj, args, context) => requestApi.totals(visibleParts(obj, context))?.vat ?? null,
			totalTTC: (obj, args, context) => requestApi.totals(visibleParts(obj, context))?.totalTTC ?? null,
		},

		RequestPart: {
			tenant: obj => tenantApi.getById(obj._tenant),
			media: obj => obj._media ? getMedia(obj._media) : null,
			answeredBy: obj => obj._answeredBy ? getUser(obj._answeredBy) : null,
		},
	},

	//--

	Mutation: `
		answerRequest(_id: String! _tenant: String! status: String! _media: String amount: Float): RequestMutation

		siteRequestCreate(token: String! info: RequestInfoInput!): RequestMutation @service
		siteRequestRevise(token: String! _id: String!): SelectionMutation @service
		siteRequestCopy(token: String! _id: String!): SelectionMutation @service
		siteRequestDecide(token: String! _id: String! decision: String!): RequestMutation @service
	`,

	MutationResolvers: {
		// quoted (with the PDF) or declined, by a manager of the tenant or an admin
		answerRequest: async (obj, {_id, _tenant, status, _media, amount}, context) => {
			try {
				if(!canAccessTenant(context, _tenant)) unauthorized()

				const request = await requestApi.answer(_id, _tenant, status, _media, context.user, amount)
				return {success: true, request}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},

		// Website: the products of an answered request go back to the selection,
		// the next request will revise it
		siteRequestRevise: async (obj, {token, _id}, context) => {
			try {
				const selection = await requestApi.revise(token, _id)
				return {success: true, selection}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},

		// Website: the products of a request go back to the selection, the next
		// request will be a new one made from it
		siteRequestCopy: async (obj, {token, _id}, context) => {
			try {
				const selection = await requestApi.copy(token, _id)
				return {success: true, selection}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},

		// Website: the selection of the customer becomes a quote request
		// Website: the customer accepts or refuses the quotes (accepted | refused)
		siteRequestDecide: async (obj, {token, _id, decision}, context) => {
			try {
				const request = await requestApi.decide(token, _id, decision)
				return {success: true, request}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},

		siteRequestCreate: async (obj, {token, info}, context) => {
			try {
				const request = await requestApi.createFromSelection(token, info)
				return {success: true, request}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},
	}
}
