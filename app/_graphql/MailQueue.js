import {genFailedMutation} from './_helper.js'
import * as mailQueueApi from '../mail-queue/mail-queue.js'

// --

const MailQueue = `
  type MailQueue {
    _id: String
    date: Date
    id: String
    tag: String
    status: String
    error: String
    raw: JSONObject
    events: [MailQueueEvent]
    resent: Date
  }
`

const MailQueueEvent = `
  type MailQueueEvent {
    date: Date
    type: String
    email: String
    error: String
    hardBounce: Boolean
  }
`

const MailQueueAttachment = `
  type MailQueueAttachment {
    filename: String
    contentType: String
    content: String
  }
`

const MailQueueAggregate = `
  type MailQueueAggregate {
    total: Int
    limit: Int
    skip: Int
    data: [MailQueue]
  }
`

const MailQueueAggregateParams = `
	input MailQueueAggregateParams {
    limit: Int
    skip: Int
    sort: JSONObject
    status: [String]
    errors: Boolean
    tag: [String]
    search: String
  }
`

// --

export default {
	TypeDefs: [
		MailQueue,
		MailQueueEvent,
		MailQueueAttachment,
		MailQueueAggregate,
		MailQueueAggregateParams
	],

	//--

	Query: `
    aggregateMailQueue(params: MailQueueAggregateParams): MailQueueAggregate @admin
    getMailQueueTags: [String] @admin
    getMailQueueAttachment(_id: String! index: Int!): MailQueueAttachment @admin
	`,

	QueryResolvers: {
		aggregateMailQueue: (obj, {params={}}) => mailQueueApi.aggregate(params),
		getMailQueueTags: () => mailQueueApi.getTags(),
		getMailQueueAttachment: (obj, {_id, index}) => mailQueueApi.getAttachment(_id, index)
	},

	//--

	Resolvers: {
	},

	//--

	Mutation: `
		resendMailQueue(_id: String!): GenericMutation @admin
		removeMailQueue(_id: String!): GenericMutation @admin
	`,

	MutationResolvers: {
		resendMailQueue: async (obj, {_id}, context) => {
			try {
				const success = await mailQueueApi.resend(_id)
				return {success, message: success ? null : 'Mail not sent'}
			} catch(err){
				return genFailedMutation(err, context)
			}
		},

		removeMailQueue: async (obj, {_id}, context) => {
			try {
				const success = await mailQueueApi.remove(_id)
				return {success}
			} catch(err){
				return genFailedMutation(err, context)
			}
		}
	}
}
