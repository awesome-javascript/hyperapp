export default function (app) {
  var view = app.view || function () {
    return ""
  }

  var model, actions = {}, reducers, effects

  var subscriptions = []
  var hooks = {
    onError: [],
    onAction: [],
    onUpdate: [],
    onRender: []
  }

  function onError(error) {
    for (var i = 0; i < hooks.onError.length; i++) {
      hooks.onError[i](error)
    }

    if (i <= 0) {
      throw error
    }
  }

  var plugins = app.plugins || []

  var node
  var root
  var batch = []

  use(app)

  for (var i = 0; i < plugins.length; i++) {
    use(plugins[i](app))
  }

  init(actions, effects, false)
  init(actions, reducers, true)

  load(function () {
    root = app.root || document.body.appendChild(document.createElement("div"))

    render(model, view)

    for (var i = 0; i < subscriptions.length; i++) {
      subscriptions[i](model, actions, onError)
    }
  })

  function use(app) {
    if (app.model !== undefined) {
      model = merge(model, app.model)
    }

    reducers = merge(reducers, app.reducers)
    effects = merge(effects, app.effects)

    if (app.subscriptions) {
      subscriptions = subscriptions.concat(app.subscriptions)
    }

    var _hooks = app.hooks
    if (_hooks) {
      Object.keys(_hooks).forEach(function (key) {
        hooks[key].push(_hooks[key])
      })
    }
  }

  function init(container, group, shouldRender, lastName) {
    Object.keys(group).forEach(function (key) {
      if (!container[key]) {
        container[key] = {}
      }

      var name = lastName ? lastName + "." + key : key
      var action = group[key]
      var i

      if (typeof action === "function") {
        container[key] = function (data) {
          for (i = 0; i < hooks.onAction.length; i++) {
            hooks.onAction[i](name, data)
          }

          if (shouldRender) {
            var oldModel = model
            model = merge(model, action(model, data))

            for (i = 0; i < hooks.onUpdate.length; i++) {
              hooks.onUpdate[i](oldModel, model, data)
            }

            render(model, view)

            return actions
          } else {
            return action(model, actions, data, onError)
          }
        }
      } else {
        init(container[key], action, shouldRender, name)
      }
    })
  }

  function load(fn) {
    if (document.readyState[0] !== "l") {
      fn()
    } else {
      document.addEventListener("DOMContentLoaded", fn)
    }
  }

  function render(model, view) {
    for (i = 0; i < hooks.onRender.length; i++) {
      view = hooks.onRender[i](model, view)
    }

    patch(root, node, node = view(model, actions), 0)

    for (var i = 0; i < batch.length; i++) {
      batch[i]()
    }

    batch = []
  }

  function merge(a, b) {
    var obj = {}
    var key

    if (isPrimitive(b) || Array.isArray(b)) {
      return b
    }

    for (key in a) {
      obj[key] = a[key]
    }
    for (key in b) {
      obj[key] = b[key]
    }

    return obj
  }

  function isPrimitive(type) {
    type = typeof type
    return type === "string" || type === "number" || type === "boolean"
  }

  function defer(fn, data) {
    setTimeout(function () {
      fn(data)
    }, 0)
  }

  function shouldUpdate(a, b) {
    return a.tag !== b.tag || typeof a !== typeof b || isPrimitive(a) && a !== b
  }

  function createElementFrom(node) {
    var element

    // There are only two types of nodes. A string node, which is
    // converted into a Text node or an object that describes an
    // HTML element and may also contain children.

    if (typeof node === "string") {
      element = document.createTextNode(node)

    } else {
      element = node.data && node.data.ns
        ? document.createElementNS(node.data.ns, node.tag)
        : document.createElement(node.tag)

      for (var name in node.data) {
        if (name === "oncreate") {
          defer(node.data[name], element)
        } else {
          setElementData(element, name, node.data[name])
        }
      }

      for (var i = 0; i < node.children.length; i++) {
        element.appendChild(createElementFrom(node.children[i]))
      }
    }

    return element
  }

  function removeElementData(element, name, value) {
    // Template functions like Hyperx add a className attribute to nodes.

    element.removeAttribute(name === "className" ? "class" : name)

    if (typeof value === "boolean" || value === "true" || value === "false") {
      element[name] = false
    }
  }

  function setElementData(element, name, value, oldValue) {
    if (name === "style") {
      for (var i in value) {
        element.style[i] = value[i]
      }

    } else if (name[0] === "o" && name[1] === "n") {
      var event = name.substr(2)

      element.removeEventListener(event, oldValue)
      element.addEventListener(event, value)

    } else {
      if (value === "false" || value === false) {
        element.removeAttribute(name)
        element[name] = false

      } else {
        element.setAttribute(name, value)

        // SVG elmeent's properties are read only in strict mode.

        if (element.namespaceURI !== "http://www.w3.org/2000/svg") {
          element[name] = value
        }
      }
    }
  }

  function updateElementData(element, data, oldData) {
    for (var name in merge(oldData, data)) {
      var value = data[name]
      var oldValue = oldData[name]
      var realValue = element[name]

      if (value === undefined) {
        removeElementData(element, name, oldValue)

      } else if (name === "onupdate") {
        defer(value, element)

      } else if (
        value !== oldValue || typeof realValue === "boolean" && realValue !== value
      ) {
        // This prevents cases where the node's data is out of sync with
        // the element's. For example, a list of checkboxes in which one
        // of the elements is recycled.

        setElementData(element, name, value, oldValue)
      }
    }
  }

  function patch(parent, oldNode, node, index) {
    if (oldNode === undefined) {
      parent.appendChild(createElementFrom(node))

    } else if (node === undefined) {
      var element = parent.childNodes[index]

      // Removing a child one at a time updates the DOM, so we end up
      // with an index out of date that needs to be adjusted. Instead,
      // collect all the elements and delete them in a batch.

      batch.push(parent.removeChild.bind(parent, element))

      if (oldNode && oldNode.data && oldNode.data.onremove) {
        defer(oldNode.data.onremove, element)
      }

    } else if (shouldUpdate(node, oldNode)) {
      parent.replaceChild(createElementFrom(node), parent.childNodes[index])

    } else if (node.tag) {
      var element = parent.childNodes[index]

      updateElementData(element, node.data, oldNode.data)

      var len = node.children.length, oldLen = oldNode.children.length

      for (var i = 0; i < len || i < oldLen; i++) {
        var child = node.children[i]

        patch(element, oldNode.children[i], child, i)
      }
    }
  }
}
