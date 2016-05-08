export default function isHostObject (object: any) {
    return typeof object.pipe === 'function' || Buffer.isBuffer(object)
  }