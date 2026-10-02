import mongoose from 'mongoose'

import {sendMail} from '../tools.js'
import {makeVersion} from '../version/version.js'

const Template = mongoose.model('Template')


//——— Public

export async function getById(_id){
	if(!_id) throw new Error('no _id')
	return Template.findOne({_id}).lean()
}

export async function getBySlug(slug){
	if(!slug) throw new Error('no slug')
	return Template.findOne({slug}).lean()
}

export async function getAll(){
	return Template.find().lean()
}

// ✓ version
export async function update(_id, data){

	const $template = await Template.findOne({_id})
	if(!$template) throw new Error('Template not exists')

	await makeVersion('template', _id, $template)

	Object
		.entries(data)
		.forEach(([key, value]) => $template.set(key, value))

	await $template.save()

	return getById(_id)
}

export async function test(_id, reqUser){

	const template = await Template.findOne({_id})
	if(!template) throw new Error('Template not exists')

	await sendMail({
		tag: 'template-test',
		to: [reqUser.login],
		subject: template.title,
		text: template.content
	})

	return true
}
