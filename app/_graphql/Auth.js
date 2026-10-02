import {genFailedMutation, isAdmin, unauthorized} from './_helper.js'
import * as userApi from '../user/user.js'
import {getByAuth} from '../user/user.js'
import {userFromToken} from '../server-middleware.js'
import {setSessionCookie, clearSessionCookie} from '../session.js'

// --

const Auth = `
  type Auth {
    token: String
    user: User
  }
`

const AuthTFA = `
  type AuthTFA {
    success: Boolean
    secret: String
    qrcode: String
  }
`

const AuthMutation = `
  type AuthMutation{
    success: Boolean
    message: String
		stack: [String]
    user: User
  }
`

// --

export default {
	TypeDefs: [
		Auth,
		AuthTFA,

		AuthMutation
	],

	//--

	Query: `
		login(login:String! password:String!): User
		getUserFromJWT: User
		getUserFromMagic(token:String!): User
    
    loginOption(auth:String!): JSONObject
    registerOption: JSONObject

		qrcodeTFA(_id:String!): AuthTFA
    verifyTFA(_id:String! token:String!): AuthTFA
    checkTFA(auth:String! token:String!): Boolean
    recoverTFA(auth:String! code:String!): Boolean    
	`,

	QueryResolvers: {
		login: (obj, {login, password}) => {
			return userApi.login(login, password)
		},


		getUserFromJWT: (obj, vars, context) => {
			if(!context.user?._id) return null
			return userApi.getById(context.user._id)
		},

		getUserFromMagic: async (obj, {token}) => {
			const auth = await userApi.getAuthFromMagic(token)
			if(!auth) return null
			return userApi.getByAuth(auth)
		},

		loginOption: (doc, {auth}) => userApi.loginOption(auth),
		registerOption: (doc, vars, context) => userApi.registerOption(context.user),

		// 2FA setup of the connected user (or an admin)
		qrcodeTFA: (obj, {_id}, context) => {
			if(!isAdmin(context) && context.user?._id?.toString() !== _id) unauthorized()
			return userApi.qrcodeTFA(_id)
		},
		verifyTFA: (obj, {_id, token}, context) => {
			if(!isAdmin(context) && context.user?._id?.toString() !== _id) unauthorized()
			return userApi.verifyTFA(_id, token)
		},
		checkTFA: (obj, {auth, token}) => userApi.checkTFA(auth, token),
		recoverTFA: (obj, {auth, code}) => userApi.recoverTFA(auth, code)
	},

	//--

	Resolvers: {
	},

	//--

	Mutation: `
		prepareReset(login: String! url: String!): AuthMutation
		resetPassword(resetToken: String! password: String!): AuthMutation
		changePassword(changeToken: String! password: String!): AuthMutation
		magicLink(login:String! url:String!): AuthMutation
		invalidateTokens(_user:String!): GenericMutation

		openSession(jwt:String!): AuthMutation
		closeSession: GenericMutation

		loginVerify(auth:String! credential:JSONObject!): AuthMutation
		registerVerify(credential:JSONObject!): AuthMutation 
		removeCredential(_id:String!): AuthMutation 
		updateCredentialName(_id:String! name:String!): AuthMutation 
	`,

	MutationResolvers: {
		prepareReset: async (obj, {login, url}, context) => {
			try {
				await userApi.prepareReset(login, url)
				return {success: true}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},

		resetPassword: async (obj, {resetToken, password}, context) => {
			try {
				await userApi.resetPassword(resetToken, password)
				return {success: true}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},

		changePassword: async (obj, {changeToken, password}, context) => {
			try {
				await userApi.changePassword(changeToken, password)
				return {success: true}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},

		magicLink: async (obj, {login, url}, context) => {
			try{
				await userApi.magicLink(login, url)
				return {success: true}
			} catch(err){
				return genFailedMutation(err, context)
			}
		},

		// Logs a user out of every device. Only the user himself, or an admin.
		invalidateTokens: async (obj, {_user}, context) => {
			try {
				const self = context.user
				const isSelf = self?._id?.toString() === _user
				const isAdmin = ['admin', 'superadmin'].includes(self?.role)
				if(!isSelf && !isAdmin) return {success: false, message: 'unauthorized'}

				await userApi.invalidateTokens(_user)
				return {success: true}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},

		// Turns a JWT obtained by login (after the second factor, if any) into the
		// httpOnly session cookie. The token itself is never stored by the front.
		openSession: async (obj, {jwt}, context) => {
			try {
				const user = await userFromToken(jwt)
				if(!user) return {success: false, message: 'unauthorized'}

				setSessionCookie(context.res, jwt)
				return {success: true, user}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},

		closeSession: async (obj, vars, context) => {
			clearSessionCookie(context.res)
			return {success: true}
		},

		loginVerify: async (obj, {auth, credential}, context) => {
			try {
				const success = await userApi.loginVerify(auth, credential)
				return {success, user: success ? await userApi.getByAuth(auth) : null}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},

		registerVerify: async (obj, {credential}, context) => {
			try {
				const success = await userApi.registerVerify(credential, context.user)
				return {success, user: success ? await userApi.getById(context.user._id) : null}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},

		removeCredential: async (obj, {_id}, context) => {
			try {
				const user = await userApi.removeCredential(_id, context.user)
				return {success: true, user}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},

		updateCredentialName: async (obj, {_id, name}, context) => {
			try {
				const user = await userApi.updateCredentialName(_id, name, context.user)
				return {success: true, user}
			} catch(err) {
				return genFailedMutation(err, context)
			}
		},

	}
}
