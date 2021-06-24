process.env.PATH = process.env.PATH + ':' + process.env['LAMBDA_TASK_ROOT']

const AWS = require('aws-sdk')
const { spawn, spawnSync } = require('child_process')
const { createReadStream, createWriteStream } = require('fs')

const s3 = new AWS.S3()
const ffprobePath = '/opt/nodejs/node_modules/ffprobe'
const ffmpegPath = '/opt/nodejs/node_modules/ffmpeg'
const allowedTypes = ['mov', 'mpg', 'mpeg', 'mp4', 'wmv', 'avi', 'webm']
const width = 120
const height = 200
const rekclient = new AWS.Rekognition();

module.exports.handler = async (event, context) => {
  console.log(`event:  ${JSON.stringify(event)}`)
  const srcKey = decodeURIComponent(event.Records[0].s3.object.key).replace(/\+/g, ' ')
  console.log(`srckey:  ${srcKey}`)
  //const srcKey = 'input/rekvideo.mp4'
  const bucket = event.Records[0].s3.bucket.name
  console.log(`bucket:  ${bucket}`)
  //const bucket = 'sunbiao-tokyo-ok-rek'
  const target = s3.getSignedUrl('getObject', { Bucket: bucket, Key: srcKey, Expires: 1000 })
  let fileType = srcKey.match(/\.\w+$/)
  let comparetarget

  if (!fileType) {
    throw new Error(`invalid file type found for key: ${srcKey}`)
  }

  fileType = fileType[0].slice(1)

  if (allowedTypes.indexOf(fileType) === -1) {
    throw new Error(`filetype: ${fileType} is not an allowed type`)
  }

  function createImage(seek) {
    return new Promise((resolve, reject) => {
      let tmpFile = createWriteStream(`/tmp/screenshot.jpg`)
      const ffmpeg = spawn(ffmpegPath, [
        '-ss',
        seek,
        '-i',
        target,
        '-vf',
        `thumbnail,scale=${width}:${height}`,
        '-qscale:v',
        '2',
        '-frames:v',
        '1',
        '-f',
        'image2',
        '-c:v',
        'mjpeg',
        'pipe:1'
      ])

      ffmpeg.stdout.pipe(tmpFile)

      ffmpeg.on('close', function(code) {
        tmpFile.end()
        resolve()
      })

      ffmpeg.on('error', function(err) {
        console.log(err)
        reject()
      })
    })
  }

  function uploadToS3(x) {
    return new Promise((resolve, reject) => {
      let tmpFile = createReadStream(`/tmp/screenshot.jpg`)
      let dstKey = srcKey.replace(/\.\w+$/, `-${x}.jpg`).replace('input', 'output')
      comparetarget = dstKey
      var params = {
        Bucket: bucket,
        Key: dstKey,
        Body: tmpFile,
        ContentType: `image/jpg`
      }

      s3.upload(params, function(err, data) {
        if (err) {
          console.log(err)
          reject()
        }
        console.log(`successful upload to ${bucket}/${dstKey}`)
        resolve()
      })
    })
  }

  const ffprobe = spawnSync(ffprobePath, [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=nw=1:nk=1',
    target
  ])

  const duration = Math.ceil(ffprobe.stdout.toString())

  await createImage(duration * 0.25)
  await uploadToS3(1)
  // await createImage(duration * .5)
  // await uploadToS3(2)
  // await createImage(duration * .75)
  // await uploadToS3(3)

  console.log(`processed ${bucket}/${srcKey} successfully`)
  
  
  function comparefaces(para){
       return new Promise((reject, resolve) => {
           rekclient.compareFaces(params,function(err,response){
               if (err) {
                   console.log("error..................")
                    console.log(err, err.stack); // an error occurred
                    reject();
                    context.fail();
                    //return {error:"error"};
               } else {
                    response.FaceMatches.forEach(data => {
                    let position   = data.Face.BoundingBox
                    let similarity = data.Similarity
                    console.log(`The face at: ${position.Left}, ${position.Top} matches with ${similarity} % confidence`)
                        }) // for response.faceDetails
                    resolve();
                    //callback(null,"end of lambda");
                    context.succeed('Success'); 
                    console.log("done!!!!!!!!!")
                    //return response;
                } // if
           });
       })
   }
  
  const params = {
     SourceImage: {
       S3Object: {
         Bucket: bucket,
         Name: 'certsample/rek.jpeg'
       },
     },
     TargetImage: {
       S3Object: {
         Bucket: bucket,
         Name: comparetarget
       },
     },
     SimilarityThreshold: 0
   }
  console.log(`compare certfile with ${comparetarget}`)
  await comparefaces(params)
  return null
}

