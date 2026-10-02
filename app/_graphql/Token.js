import {generateToken, getTokenData} from '../token/token.js'
import {genFailedMutation} from './_helper.js'

const Token = `
  type Token {
    args: JSONObject
  }
`

const TokenMutation = `
  type TokenMutation{
    success: Boolean
    message: String
		stack: [String]
    token: String
  }
`

export default {
	TypeDefs: [
		Token,

		TokenMutation
	],

	//--

	Query: `
		getToken(token:String!): Token @admin
	`,

	QueryResolvers: {
		getToken: async (doc, {token}, context) => {
			try {
				const args = await getTokenData(token)
				return {token, args}
			} catch(err){
				return genFailedMutation(err, context)
			}
		}
	},

	//--

	Resolvers: {
	},

	//--

	Mutation: `
		generateToken(args:JSONObject! minutes:Int id:String): TokenMutation @admin
	`,

	MutationResolvers: {
		generateToken: async (doc, {args, minutes=60, id}, context) => {
			try {
				const token = await generateToken(args, minutes, id)
				return {success: true, token, args}
			} catch(err){
				return genFailedMutation(err, context)
			}
		}
	}

}
