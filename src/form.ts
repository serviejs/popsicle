import FormData = require('form-data')

export default function form (obj: any) {
  const form = new FormData()

  if (obj) {
    Object.keys(obj).forEach(function (name) {
      form.append(name, obj[name])
    })
  }

  return form
}
