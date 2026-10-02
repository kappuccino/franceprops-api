import {genFailedMutation, getCountryName} from './_helper.js'
import * as customerApi from '../customer/customer.js'

// --

const Customer = `
  type Customer {
    _id: String
    email: String

    firstName: String
    lastName: String
    fullName: String
    phone: String
    company: String

    address: String
    postal: String
    city: String
    country: String
    countryName: String

    created: Date
    updated: Date
  }
`

const CustomerSearch = `
  type CustomerSearch {
    total: Int
    limit: Int
    skip: Int
    data: [Customer]
  }
`

const CustomerSearchParams = `
  input CustomerSearchParams {
    limit: Int
    skip: Int
    sort: JSONObject
    search: String
  }
`

const CustomerMutation = `
  type CustomerMutation{
    success: Boolean
    message: String
		stack: [String]
    customer: Customer
  }
`

// --

export default {
	TypeDefs: [
		Customer,
		CustomerSearch,
		CustomerSearchParams,

		CustomerMutation
	],

	//--

	Query: `
    searchCustomer(params: CustomerSearchParams): CustomerSearch @admin
    getCustomerById(_id: String!): Customer @admin
	`,

	QueryResolvers: {
		searchCustomer: (obj, {params={}}) => customerApi.aggregate(params),
		getCustomerById: (obj, {_id}) => customerApi.getById(_id),
	},

	//--

	Resolvers: {
		Customer: {
			fullName: obj => `${obj.firstName || ''} ${obj.lastName || ''}`.trim(),
			countryName: obj => getCountryName(obj.country),
		}
	},

	//--

	Mutation: `
		createCustomer(data: JSONObject!): CustomerMutation @admin
		updateCustomer(_id: String! data: JSONObject!): CustomerMutation @admin
		removeCustomer(_id: String!): CustomerMutation @admin
	`,

	MutationResolvers: {
		createCustomer: async (obj, {data}, context) => {
			try {
				const customer = await customerApi.create(data)
				return {success: true, customer}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},

		updateCustomer: async (obj, {_id, data}, context) => {
			try {
				const customer = await customerApi.update(_id, data)
				return {success: true, customer}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},

		removeCustomer: async (obj, {_id}, context) => {
			try {
				await customerApi.remove(_id)
				return {success: true}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},
	}
}
