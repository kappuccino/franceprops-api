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

    createdAt: Date
    updatedAt: Date
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

const CustomerAuth = `
  type CustomerAuth {
    success: Boolean
    message: String
    token: String
    customer: Customer
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

		CustomerAuth,
		CustomerMutation
	],

	//--

	Query: `
    searchCustomer(params: CustomerSearchParams): CustomerSearch @admin
    getCustomerById(_id: String!): Customer @admin

    customerFromToken(token: String!): Customer @service
	`,

	QueryResolvers: {
		searchCustomer: (obj, {params={}}) => customerApi.aggregate(params),
		getCustomerById: (obj, {_id}) => customerApi.getById(_id),

		// Website session, checked by the Nuxt server
		customerFromToken: (obj, {token}) => customerApi.fromToken(token),
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

		customerLogin(email: String! password: String!): CustomerAuth @service
		customerSignupStart(email: String!): GenericMutation @service
		customerSignupConfirm(email: String! code: String! data: JSONObject!): CustomerAuth @service
		customerUpdateProfile(token: String! data: JSONObject!): CustomerMutation @service
		customerChangePassword(token: String! current: String! password: String!): CustomerAuth @service
		customerPasswordStart(email: String!): GenericMutation @service
		customerPasswordConfirm(email: String! code: String! password: String!): CustomerAuth @service
		customerEmailStart(token: String! email: String! password: String!): GenericMutation @service
		customerEmailConfirm(token: String! code: String!): CustomerAuth @service
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

		// Website login, the token is kept by the Nuxt server in an httpOnly cookie
		customerLogin: async (obj, {email, password}, context) => {
			try {
				const res = await customerApi.login(email, password)
				if(!res) return {success: false, message: 'Invalid credentials'}

				return {success: true, ...res}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},

		// Website signup, step 1: the confirmation code is sent by mail
		customerSignupStart: async (obj, {email}, context) => {
			try {
				await customerApi.signupStart(email)
				return {success: true}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},

		// Website lost password, step 1: code sent by mail (same answer when the
		// account does not exist)
		customerPasswordStart: async (obj, {email}, context) => {
			try {
				await customerApi.passwordStart(email)
				return {success: true}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},

		// Step 2: new password, the customer is logged in
		customerPasswordConfirm: async (obj, {email, code, password}, context) => {
			try {
				const res = await customerApi.passwordConfirm(email, code, password)
				return {success: true, ...res}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},

		// Website "Mon compte": the customer of the session token only
		customerUpdateProfile: async (obj, {token, data}, context) => {
			try {
				const customer = await customerApi.updateProfile(token, data)
				return {success: true, customer}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},

		customerChangePassword: async (obj, {token, current, password}, context) => {
			try {
				const res = await customerApi.changePassword(token, current, password)
				return {success: true, ...res}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},

		// Website email change, step 1: code sent to the new address
		customerEmailStart: async (obj, {token, email, password}, context) => {
			try {
				await customerApi.emailStart(token, email, password)
				return {success: true}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},

		// Website email change, step 2: email changed, new session for this device
		customerEmailConfirm: async (obj, {token, code}, context) => {
			try {
				const res = await customerApi.emailConfirm(token, code)
				return {success: true, ...res}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},

		// Website signup, step 2: code checked, account created and logged in
		customerSignupConfirm: async (obj, {email, code, data}, context) => {
			try {
				const res = await customerApi.signupConfirm(email, code, data)
				return {success: true, ...res}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},
	}
}
