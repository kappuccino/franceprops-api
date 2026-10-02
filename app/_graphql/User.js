import {genFailedMutation, getMedia} from './_helper.js'
import * as userApi from '../user/user.js'
import * as tenantApi from '../tenant/tenant.js'

// --

const User = `
  type User {
    _id: String
    firstName: String
    lastName: String
    fullName: String
    name: String
    login: String
    needChange: Boolean
    change: String
    role: String
    permissions: [String]
    auth: String
    isTFAenabled: Boolean
    jwt(expiresIn:Int): String
    recovery: [String]

    _picture: String
    picture(height:Int width:Int): Media

    _tenants: [String]
    tenants: [Tenant]

		
		credentials: [UserCredential]
		
		tokenVersion: Int
  }
`

const UserCredential = `
  type UserCredential {
    _id: String
		credentialID: String
    name: String
    createdAt: Date
    lastUsedAt: Date
  }
`

const UserSearch = `
  type UserSearch {
    total: Int
    limit: Int
    skip: Int
    data: [User]
  }
`

const UserSearchParams = `
  input UserSearchParams {
    limit: Int
    skip: Int
    sort: JSONObject
    search: String
    role: String
    tenant: String
  }
`

const UserMutation = `
  type UserMutation{
    success: Boolean
    message: String
		stack: [String]
    user: User
  }
`

// --

export default {
	TypeDefs: [
		User,
		UserCredential,
		UserSearch,
		UserSearchParams,

		UserMutation
	],

	//--

	Query: `
    searchUser(params:UserSearchParams): UserSearch
    getUserById(_id: String!): User
	`,

	QueryResolvers: {
		searchUser: (obj, {params}) => userApi.aggregate(params),
		getUserById: (obj, {_id}) => userApi.getById(_id),
	},

	// --

	Resolvers: {
		User: {
			fullName: obj => `${obj.firstName || ''} ${obj.lastName || ''}`.trim(),
			picture: (obj, args) => getMedia(obj._picture, args),
			jwt: (obj, {expiresIn}) => userApi.createJWT(obj, {expiresIn}),
			isTFAenabled: obj => Boolean(obj.tfa),
			tenants: obj => tenantApi.getByIds(obj._tenants),
		}
	},

	//--

	Mutation: `
		createUser(data:JSONObject!): UserMutation
		updateUser(_id:String! data:JSONObject!): UserMutation
		removeUser(_id:String!): UserMutation
	`,

	MutationResolvers: {
		createUser: async (obj, {data}, context) => {
			try {
				const user = await userApi.create(data)
				return {success: true, user}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},

		updateUser: async (obj, {_id, data}, context) => {
			try {
				const user = await userApi.update(_id, data)
				return {success: true, user}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},

		removeUser: async (obj, {_id}, context) => {
			try {
				await userApi.remove(_id)
				return {success: true}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},

	},

}
