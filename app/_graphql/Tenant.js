import {genFailedMutation} from './_helper.js'
import * as tenantApi from '../tenant/tenant.js'

// --

const Tenant = `
  type Tenant {
    _id: String
    name: String

    createdAt: Date
    updatedAt: Date
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

export default {
	TypeDefs: [
		Tenant,
		TenantSearch,
		TenantSearchParams,

		TenantMutation
	],

	//--

	Query: `
    searchTenant(params: TenantSearchParams): TenantSearch @admin
    getTenantById(_id: String!): Tenant @admin
	`,

	QueryResolvers: {
		searchTenant: (obj, {params={}}) => tenantApi.aggregate(params),
		getTenantById: (obj, {_id}) => tenantApi.getById(_id),
	},

	//--

	Resolvers: {
	},

	//--

	Mutation: `
		createTenant(data: JSONObject!): TenantMutation @admin
		updateTenant(_id: String! data: JSONObject!): TenantMutation @admin
		removeTenant(_id: String!): TenantMutation @admin
	`,

	MutationResolvers: {
		createTenant: async (obj, {data}, context) => {
			try {
				const tenant = await tenantApi.create(data)
				return {success: true, tenant}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},

		updateTenant: async (obj, {_id, data}, context) => {
			try {
				const tenant = await tenantApi.update(_id, data)
				return {success: true, tenant}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},

		removeTenant: async (obj, {_id}, context) => {
			try {
				await tenantApi.remove(_id)
				return {success: true}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},
	}
}
