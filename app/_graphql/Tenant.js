import {genFailedMutation, requireAdmin} from './_helper.js'
import * as tenantApi from '../tenant/tenant.js'

// --

const Tenant = `
  type Tenant {
    _id: String
    name: String

    created: Date
    updated: Date
  }
`

const TenantSearch = `
  type TenantSearch {
    total: Int
    limit: Int
    skip: Int
    data: [Tenant]
  }
`

const TenantSearchParams = `
  input TenantSearchParams {
    limit: Int
    skip: Int
    sort: JSONObject
    search: String
  }
`

const TenantMutation = `
  type TenantMutation{
    success: Boolean
    message: String
		stack: [String]
    tenant: Tenant
  }
`

// --

// Tenants are managed by admins and superadmins only
export default {
	TypeDefs: [
		Tenant,
		TenantSearch,
		TenantSearchParams,

		TenantMutation
	],

	//--

	Query: `
    searchTenant(params: TenantSearchParams): TenantSearch
    getTenantById(_id: String!): Tenant
	`,

	QueryResolvers: {
		searchTenant: (obj, {params={}}, context) => {
			requireAdmin(context)
			return tenantApi.aggregate(params)
		},

		getTenantById: (obj, {_id}, context) => {
			requireAdmin(context)
			return tenantApi.getById(_id)
		},
	},

	//--

	Resolvers: {
	},

	//--

	Mutation: `
		createTenant(data: JSONObject!): TenantMutation
		updateTenant(_id: String! data: JSONObject!): TenantMutation
		removeTenant(_id: String!): TenantMutation
	`,

	MutationResolvers: {
		createTenant: async (obj, {data}, context) => {
			try {
				requireAdmin(context)
				const tenant = await tenantApi.create(data)
				return {success: true, tenant}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},

		updateTenant: async (obj, {_id, data}, context) => {
			try {
				requireAdmin(context)
				const tenant = await tenantApi.update(_id, data)
				return {success: true, tenant}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},

		removeTenant: async (obj, {_id}, context) => {
			try {
				requireAdmin(context)
				await tenantApi.remove(_id)
				return {success: true}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},
	}
}
