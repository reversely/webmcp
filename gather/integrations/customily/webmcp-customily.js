/**
 * WebMCP adapter for a Customily-personalized Shopify product page.
 *
 * Registers four tools on `document.modelContext` so a browser agent can read the product's
 * personalization fields, configure a unit for one recipient, check the preview, and add the
 * configured unit through Customily's own add-to-cart button. Every DOM selector lives in
 * PRODUCT_ADAPTERS, keyed by the numeric Shopify product id, so the tool bodies stay generic
 * and a new product needs only a new adapter entry.
 *
 * Install: load this file after the theme's content on the product template (see README.md).
 * The page must expose `document.modelContext` natively or through the WebMCP polyfill.
 */
(function () {
  "use strict";

  /**
   * Per-product semantic field configuration. Selectors were read from the live storefront DOM
   * on 2026-08-30. Each field names its kind, its storefront label, and the control adapter
   * that drives it; the control adapters at the bottom of this file consume `selectors`.
   */
  const PRODUCT_ADAPTERS = {
    "10242071789817": {
      title: "Customized Crewneck",
      variant: {
        // The theme's product form; Customily reads the selected variant from this hidden input.
        hiddenIdInput: 'form[action*="/cart/add"] input[name="id"]',
        // Size radios; clicking one makes the theme rewrite the hidden id input.
        optionRadios: 'input[type="radio"][name^="Size-"]',
        settleMs: 4000
      },
      preview: {
        // Customily renders the composed preview into fabric.js canvases inside this container.
        container: ".cl-canvas-container",
        canvas: ".cl-canvas-container canvas",
        // The canvas wrapper keeps this class until the first render completes.
        pendingClass: "op-zero",
        timeoutMs: 20000
      },
      cart: {
        // Customily's own add-to-cart button; it sits outside the theme form on purpose.
        button: "#customily-cart-btn",
        settleMs: 25000
      },
      fields: {
        star_map_location: {
          kind: "location",
          label: "Enter Location for Star Map 1",
          required: true,
          control: "mapbox_autocomplete",
          selectors: {
            input: 'input[placeholder="Search Location"]',
            suggestions: ".suggestions li a",
            latitude: "#lat",
            longitude: "#lon"
          },
          notes: "Send a place name; the tool picks the first geocoder suggestion."
        },
        star_map_date: {
          kind: "date",
          label: "Pick a date for Star Map 1",
          required: true,
          control: "date_input",
          selectors: { input: "#datepicker-star-map" },
          notes: "ISO date, for example 2027-02-14."
        },
        caption: {
          kind: "text",
          label: "Text 2",
          required: true,
          control: "text_input",
          selectors: { input: 'input[name="properties[Text 2]"]' },
          notes: "Customily renders the caption in upper case."
        }
      }
    }
  };

  /** Configured units for this page session, keyed by recipient_ref. */
  const units = new Map();
  let previewCounter = 0;

  function q(selector) {
    return document.querySelector(selector);
  }

  function result(payload, isError) {
    const out = { content: [{ type: "text", text: JSON.stringify(payload) }] };
    if (isError) out.isError = true;
    return out;
  }

  function fail(message, extra) {
    return result(Object.assign({ error: message }, extra || {}), true);
  }

  function sleep(ms, signal) {
    return new Promise(function (resolve, reject) {
      if (signal && signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
      const t = setTimeout(resolve, ms);
      if (signal) signal.addEventListener("abort", function () {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      }, { once: true });
    });
  }

  /** Polls `check` every 250ms until it returns a truthy value or `timeoutMs` passes. */
  async function waitFor(check, timeoutMs, signal) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = check();
      if (value) return value;
      if (Date.now() >= deadline) return null;
      await sleep(250, signal);
    }
  }

  /** As waitFor, for an async check: awaits each probe before deciding. */
  async function waitForAsync(check, timeoutMs, signal) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await check();
      if (value) return value;
      if (Date.now() >= deadline) return null;
      await sleep(500, signal);
    }
  }

  /** Sets an input's value through the native setter so framework listeners see the change. */
  function setNativeValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
  }

  function fire(el, type) {
    el.dispatchEvent(new Event(type, { bubbles: true }));
  }

  function currentAdapter() {
    const idInput = q('form[action*="/cart/add"] input[name="product-id"]');
    const productId = idInput ? idInput.value : null;
    return { productId: productId, adapter: productId ? PRODUCT_ADAPTERS[productId] : null };
  }

  function hiddenVariantId(adapter) {
    const input = q(adapter.variant.hiddenIdInput);
    return input ? input.value : null;
  }

  /**
   * Selects the Shopify variant whose id is `variantId`. The theme carries no per-radio variant
   * id, so this clicks through the option radios and watches the hidden id input until it holds
   * the requested value. The discovered value-to-id map rides along in the error on failure.
   */
  async function selectVariant(adapter, variantId, signal) {
    if (hiddenVariantId(adapter) === variantId) return { ok: true };
    const radios = Array.from(document.querySelectorAll(adapter.variant.optionRadios));
    if (radios.length === 0) return { ok: false, error: "no variant radios found on this page" };
    const discovered = {};
    for (const radio of radios) {
      const before = hiddenVariantId(adapter);
      radio.click();
      fire(radio, "change");
      // The theme rewrites the hidden id after a section fetch; an already-selected radio
      // changes nothing, so a timeout falls back to the current id.
      const changed = await waitFor(function () {
        const id = hiddenVariantId(adapter);
        return id && id !== before ? id : null;
      }, adapter.variant.settleMs, signal);
      const id = changed || hiddenVariantId(adapter);
      if (id) discovered[radio.value] = id;
      if (id === variantId) return { ok: true, option_value: radio.value };
    }
    return { ok: false, error: "variant_id matches none of this product's variants", available: discovered };
  }

  /** Control adapters: each drives one storefront control kind through its configured selectors. */
  const CONTROLS = {
    text_input: async function (field, value) {
      const input = q(field.selectors.input);
      if (!input) return "control not found: " + field.selectors.input;
      setNativeValue(input, String(value));
      fire(input, "input");
      fire(input, "change");
      fire(input, "blur");
      return null;
    },

    date_input: async function (field, value) {
      const input = q(field.selectors.input);
      if (!input) return "control not found: " + field.selectors.input;
      const iso = String(value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "date must be YYYY-MM-DD";
      setNativeValue(input, iso);
      if (input.value !== iso) return "the date input rejected " + iso;
      fire(input, "input");
      fire(input, "change");
      return null;
    },

    /**
     * The location field runs Mapbox's geocoder: it geocodes on keydown and only commits
     * coordinates when a suggestion is picked, so this types the query, waits for the
     * suggestion list, and clicks the first entry.
     */
    mapbox_autocomplete: async function (field, value, signal) {
      const input = q(field.selectors.input);
      if (!input) return "control not found: " + field.selectors.input;
      const latBefore = q(field.selectors.latitude) ? q(field.selectors.latitude).value : null;
      input.focus();
      setNativeValue(input, String(value));
      fire(input, "input");
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "e", bubbles: true }));
      const suggestion = await waitFor(function () {
        const el = q(field.selectors.suggestions);
        return el && (el.offsetWidth || el.offsetHeight) ? el : null;
      }, 8000, signal);
      if (!suggestion) return "the location geocoder returned no suggestions for " + JSON.stringify(String(value));
      const committedCoords = function () {
        const lat = q(field.selectors.latitude);
        return lat && lat.value && lat.value !== "0" && lat.value !== latBefore ? lat.value : null;
      };
      // The geocoder commits a pick on a real mouse sequence, so send mousedown through click.
      for (const type of ["mousedown", "mouseup", "click"]) {
        suggestion.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      }
      let committed = await waitFor(committedCoords, 5000, signal);
      if (!committed) {
        // Second path: the geocoder also commits on ArrowDown plus Enter in the search input.
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", keyCode: 40, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
        committed = await waitFor(committedCoords, 5000, signal);
      }
      if (!committed) return "picking the location suggestion set no coordinates";
      return null;
    }
  };

  function previewState(adapter) {
    const canvas = q(adapter.preview.canvas);
    const container = canvas ? canvas.closest(".canvas-container") : null;
    const visible = !!(canvas && (canvas.offsetWidth || canvas.offsetHeight));
    const pending = !!(container && container.classList.contains(adapter.preview.pendingClass));
    return { present: !!canvas, ready: visible && !pending, canvas: canvas };
  }

  /**
   * A small thumbnail of the preview canvas as a data URL. Returns null when the canvas is
   * tainted by cross-origin art and refuses export; readiness does not depend on this.
   */
  function previewThumbnail(canvas) {
    try {
      const thumb = document.createElement("canvas");
      thumb.width = 128;
      thumb.height = Math.max(1, Math.round((canvas.height / canvas.width) * 128) || 128);
      thumb.getContext("2d").drawImage(canvas, 0, 0, thumb.width, thumb.height);
      return thumb.toDataURL("image/png");
    } catch (err) {
      return null;
    }
  }

  /** Required fields the caller left out and the storefront control also holds empty. */
  function missingRequired(adapter, values) {
    const errors = [];
    for (const key of Object.keys(adapter.fields)) {
      const field = adapter.fields[key];
      if (!field.required || values[key] !== undefined) continue;
      const input = q(field.selectors.input);
      if (!input || !input.value) errors.push({ field_key: key, message: "required and no value supplied" });
    }
    return errors;
  }

  const TOOLS = [
    {
      name: "get_personalization_schema",
      description:
        "Returns the personalization fields of the Customily product on this page: each field's key, kind, label, control, and whether it is required, plus the variant options and the currently selected variant id. Call this before configure_personalized_unit.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: async function () {
        const { productId, adapter } = currentAdapter();
        if (!adapter) return fail("no personalization adapter for this page", { product_id: productId });
        const fields = Object.keys(adapter.fields).map(function (key) {
          const f = adapter.fields[key];
          return { key: key, kind: f.kind, label: f.label, control: f.control, required: !!f.required, notes: f.notes };
        });
        const optionValues = Array.from(document.querySelectorAll(adapter.variant.optionRadios)).map(function (r) {
          return r.value;
        });
        return result({
          product_id: productId,
          title: adapter.title,
          current_variant_id: hiddenVariantId(adapter),
          variant_option_values: optionValues,
          fields: fields
        });
      }
    },

    {
      name: "configure_personalized_unit",
      description:
        "Configures one personalized unit on this product page for one recipient: selects the Shopify variant, fills each personalization field through its storefront control, and waits for the Customily preview to render. values maps field keys from get_personalization_schema to the recipient's values. Returns the applied configuration or the per-field errors.",
      inputSchema: {
        type: "object",
        properties: {
          recipient_ref: { type: "string", description: "The caller's stable reference for the recipient this unit belongs to" },
          variant_id: { type: "string", description: "The numeric Shopify variant id to select" },
          values: { type: "object", description: "Field key to value, using the keys from get_personalization_schema" }
        },
        required: ["recipient_ref", "variant_id", "values"],
        additionalProperties: false
      },
      execute: async function (args, options) {
        const signal = options ? options.signal : undefined;
        const { productId, adapter } = currentAdapter();
        if (!adapter) return fail("no personalization adapter for this page", { product_id: productId });
        if (!args.recipient_ref) return fail("recipient_ref must be a non-empty string");

        const variant = await selectVariant(adapter, String(args.variant_id), signal);
        if (!variant.ok) return fail(variant.error, { recipient_ref: args.recipient_ref, available_variants: variant.available });

        const values = args.values || {};
        const errors = [];
        for (const key of Object.keys(values)) {
          const field = adapter.fields[key];
          if (!field) {
            errors.push({ field_key: key, message: "unknown field" });
            continue;
          }
          const problem = await CONTROLS[field.control](field, values[key], signal);
          if (problem) errors.push({ field_key: key, message: problem });
        }
        errors.push.apply(errors, missingRequired(adapter, values));
        if (errors.length > 0) return fail("configuration failed", { recipient_ref: args.recipient_ref, errors: errors });

        const ready = await waitFor(function () {
          return previewState(adapter).ready || null;
        }, adapter.preview.timeoutMs, signal);
        if (!ready) return fail("the Customily preview did not render in time", { recipient_ref: args.recipient_ref });

        previewCounter += 1;
        const unit = {
          recipient_ref: args.recipient_ref,
          product_id: productId,
          variant_id: String(args.variant_id),
          values: values,
          preview_id: "preview-" + previewCounter,
          configured_at: new Date().toISOString()
        };
        units.set(args.recipient_ref, unit);
        return result({
          recipient_ref: unit.recipient_ref,
          product_id: productId,
          variant_id: unit.variant_id,
          values_applied: Object.keys(values),
          preview: { ready: true, preview_id: unit.preview_id },
          errors: []
        });
      }
    },

    {
      name: "get_personalization_preview",
      description:
        "Reports whether the Customily preview for a configured recipient is rendered on this page. Returns ready, a preview id, a small preview thumbnail data URL when the canvas allows export, and structured errors.",
      inputSchema: {
        type: "object",
        properties: {
          recipient_ref: { type: "string", description: "The recipient_ref passed to configure_personalized_unit" }
        },
        required: ["recipient_ref"],
        additionalProperties: false
      },
      execute: async function (args) {
        const { adapter } = currentAdapter();
        if (!adapter) return fail("no personalization adapter for this page");
        const unit = units.get(args.recipient_ref);
        if (!unit) {
          return result({ recipient_ref: args.recipient_ref, ready: false, errors: [{ message: "no configured unit for this recipient_ref; call configure_personalized_unit first" }] }, true);
        }
        const state = previewState(adapter);
        const payload = { recipient_ref: args.recipient_ref, ready: state.ready, preview_id: unit.preview_id, errors: [] };
        if (state.ready) {
          const thumb = previewThumbnail(state.canvas);
          if (thumb) payload.preview_url = thumb;
        } else {
          payload.errors.push({ message: state.present ? "the preview canvas is still hidden" : "no preview canvas on this page" });
        }
        return result(payload, state.ready ? false : true);
      }
    },

    {
      name: "add_personalized_unit_to_cart",
      description:
        "Adds the configured unit for a recipient to the cart by pressing Customily's own add-to-cart button, then waits for the new cart line. Returns the Shopify cart line key and its personalization properties so the caller can tie the line to the recipient. Configure the unit first; the page holds one live configuration at a time.",
      inputSchema: {
        type: "object",
        properties: {
          recipient_ref: { type: "string", description: "The recipient_ref passed to configure_personalized_unit" }
        },
        required: ["recipient_ref"],
        additionalProperties: false
      },
      execute: async function (args, options) {
        const signal = options ? options.signal : undefined;
        const { adapter } = currentAdapter();
        if (!adapter) return fail("no personalization adapter for this page");
        const unit = units.get(args.recipient_ref);
        if (!unit) return fail("no configured unit for this recipient_ref; call configure_personalized_unit first", { recipient_ref: args.recipient_ref });
        const button = q(adapter.cart.button);
        if (!button) return fail("Customily's add-to-cart button is not on this page", { selector: adapter.cart.button });

        const before = await fetch("/cart.js", { signal: signal }).then(function (r) { return r.json(); });
        const beforeKeys = new Set(before.items.map(function (i) { return i.key; }));
        button.click();
        const added = await waitForAsync(function () {
          return fetch("/cart.js", { signal: signal }).then(function (r) { return r.json(); }).then(function (cart) {
            return cart.items.find(function (i) { return !beforeKeys.has(i.key); }) || null;
          }).catch(function () { return null; });
        }, adapter.cart.settleMs, signal);
        if (!added) return fail("no new cart line appeared after pressing add to cart", { recipient_ref: args.recipient_ref });

        unit.cart_line_key = added.key;
        return result({
          recipient_ref: args.recipient_ref,
          cart_line_key: added.key,
          variant_id: String(added.variant_id),
          quantity: added.quantity,
          properties: added.properties || {},
          preview_id: unit.preview_id
        });
      }
    }
  ];

  function register() {
    if (!document.modelContext) {
      console.warn("webmcp-customily: document.modelContext is unavailable so no tools are registered");
      return;
    }
    const controller = new AbortController();
    window.__gatherCustomilyAbort = controller;
    for (const tool of TOOLS) {
      Promise.resolve(document.modelContext.registerTool(tool, { signal: controller.signal })).catch(function (err) {
        console.warn("webmcp-customily: registering " + tool.name + " failed", err);
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", register, { once: true });
  } else {
    register();
  }
})();
