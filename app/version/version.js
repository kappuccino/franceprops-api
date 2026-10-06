import mongoose from 'mongoose'

const Version = mongoose.model('Version')

export async function makeVersion(source, _source, $data){

	const item = {
		createdAt: new Date(),
		data: $data.toObject ? $data.toObject() : $data
	}

	await Version.findOneAndUpdate(
		{_source},
		{
			$push: {
				versions: {
					$each: [item],
					$slice: -100
				}
			},
			$setOnInsert: { source, _source }
		},
		{upsert: true}
	)
}
