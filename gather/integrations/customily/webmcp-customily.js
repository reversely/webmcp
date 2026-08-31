/**
 * WebMCP adapter for a Customily-personalized Shopify product page.
 *
 * Registers three batch tools on `document.modelContext` so a browser agent can read a product's
 * personalization schema, dry-run a whole batch of personalized items, and configure plus add the
 * whole batch to the cart in one call. Every DOM selector lives in PRODUCT_ADAPTERS, keyed by the
 * numeric Shopify product id, so the tool bodies stay generic and a new product needs only a new
 * adapter entry.
 *
 * Install: load this file after the theme's content on the product template (see README.md).
 * The page must expose `document.modelContext` natively or through the WebMCP polyfill.
 */
(function () {
  "use strict";

  /**
   * Per-product semantic field configuration. Selectors were read from the live storefront DOM
   * on 2026-08-31. Each field names its kind, its storefront label, and the control adapter
   * that drives it; the control adapters at the bottom of this file consume `selectors`.
   * `handle` lets the tools fetch `/products/<handle>.js` for variant resolution without a
   * DOM write. A field may carry `max_length` when the storefront enforces one; none of the
   * live inputs declares a maxlength today.
   */
  const PRODUCT_ADAPTERS = {
    "10242071789817": {
      title: "Customized Crewneck",
      handle: "1566-comfort-colors-garment-dyed-adult-crewneck-sweatshirt",
      variant: {
        // The theme's product form; Customily reads the selected variant from this hidden input.
        hiddenIdInput: 'form[action*="/cart/add"] input[name="id"]',
        // Option radios are named "<OptionName>-<section id>"; the theme rewrites the hidden
        // id input after a radio click.
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
    },

    "10243540517113": {
      title: "Custom Dark Hoodie",
      handle: "1567-comfort-colors-garment-dyed-adult-hoodie",
      variant: {
        hiddenIdInput: 'form[action*="/cart/add"] input[name="id"]',
        settleMs: 4000
      },
      preview: {
        container: ".cl-canvas-container",
        canvas: ".cl-canvas-container canvas",
        pendingClass: "op-zero",
        timeoutMs: 30000
      },
      cart: {
        button: "#customily-cart-btn",
        settleMs: 25000
      },
      fields: {
        caption: {
          kind: "text",
          label: "Text 2",
          required: true,
          control: "text_input",
          // Verified live on 2026-08-31 as id cl-set-237dc8f1-b3d2-4640-b999-4da9fa48ea23-cl-option-1;
          // the property name survives a Customily set re-id, so the name selector is the anchor.
          selectors: { input: 'input[name="properties[Text 2]"]' },
          notes: "Customily renders the caption on the garment."
        },
        photo: {
          kind: "image",
          label: "Image Upload 1",
          required: true,
          control: "file_input",
          // Verified live on 2026-08-31 as data-testid file-input-237dc8f1-b3d2-4640-b999-4da9fa48ea23-2.
          selectors: { input: 'input[type="file"][name="properties[Image Upload 1]"]' },
          accept: ["image/png", "image/jpeg", "image/bmp", "image/webp", "image/heic", "image/dng"],
          notes: "Send an https URL or a data URL for a png, jpeg, bmp, webp, heic, or dng image."
        }
      }
    },

    "10243494084857": {
      title: "Custom Ceramic Mug",
      handle: "21504-white-15oz-ceramic-mug",
      variant: {
        hiddenIdInput: 'form[action*="/cart/add"] input[name="id"]',
        settleMs: 4000
      },
      preview: {
        container: ".cl-canvas-container",
        canvas: ".cl-canvas-container canvas",
        pendingClass: "op-zero",
        timeoutMs: 30000
      },
      cart: {
        button: "#customily-cart-btn",
        settleMs: 25000
      },
      fields: {
        // The mug's Customily template carries this image field, and the storefront page still
        // renders no controls as of 2026-08-31, so validate and create report a per-item
        // "control not rendered" issue until the template propagates.
        photo: {
          kind: "image",
          label: "Image Upload 1",
          required: true,
          control: "file_input",
          selectors: { input: 'input[type="file"][name="properties[Image Upload 1]"]' },
          accept: ["image/png", "image/jpeg", "image/bmp", "image/webp", "image/heic", "image/dng"],
          notes: "Send an https URL or a data URL for a png, jpeg, bmp, webp, heic, or dng image."
        }
      }
    }
  };

  /** The cart-line property Customily writes with the rendered preview image URL. */
  const PREVIEW_PROPERTY = "_customily-preview";

  /** sessionStorage prefix for the create tool's idempotency records. */
  const IDEMPOTENCY_PREFIX = "gather-customily-batch:";

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
   * The product's variants and options from the storefront's own JSON endpoint. A read, not a
   * DOM write, so validate can use it from any page on the shop's origin. Returns null when the
   * endpoint does not answer, and the caller turns that into an isError result (#122 pattern).
   */
  async function fetchProductJson(adapter, signal) {
    try {
      const res = await fetch("/products/" + adapter.handle + ".js", { signal: signal });
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      return null;
    }
  }

  function findVariant(productJson, variantId) {
    return productJson.variants.find(function (v) { return String(v.id) === String(variantId); }) || null;
  }

  /**
   * Selects the Shopify variant whose id is `variantId`. The theme names each option's radios
   * "<OptionName>-<section id>" and carries no per-radio variant id, so this looks the variant's
   * option values up in the product JSON, clicks the matching radio in each option group, and
   * waits for the product form's hidden id input to hold the requested value.
   */
  async function selectVariant(adapter, productJson, variantId, signal) {
    if (hiddenVariantId(adapter) === String(variantId)) return { ok: true };
    const variant = findVariant(productJson, variantId);
    if (!variant) {
      return { ok: false, error: "variant_id matches none of this product's variants", available: productJson.variants.map(function (v) { return { id: String(v.id), title: v.title }; }) };
    }
    for (let i = 0; i < productJson.options.length; i++) {
      const optionName = productJson.options[i].name;
      const value = variant.options[i];
      const radios = Array.from(document.querySelectorAll('input[type="radio"][name^="' + optionName + '-"]'));
      if (radios.length === 0) continue; // a single-value option renders no picker
      const radio = radios.find(function (r) { return r.value === value; });
      if (!radio) return { ok: false, error: "no " + optionName + " control offers " + JSON.stringify(value) };
      if (radio.checked) continue;
      const before = hiddenVariantId(adapter);
      radio.click();
      fire(radio, "change");
      // The theme rewrites the hidden id after a section fetch; wait for it to move on.
      await waitFor(function () {
        const id = hiddenVariantId(adapter);
        return id && id !== before ? id : null;
      }, adapter.variant.settleMs, signal);
    }
    const settled = await waitFor(function () {
      return hiddenVariantId(adapter) === String(variantId) ? true : null;
    }, adapter.variant.settleMs, signal);
    if (!settled) return { ok: false, error: "the theme did not settle on variant " + variantId, current: hiddenVariantId(adapter) };
    return { ok: true };
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
      // The Mapbox geocoder's suggestion handler reads the pointer coordinates off the event, so
      // a bare MouseEvent with no clientX/clientY is ignored; send the sequence at the suggestion's
      // own centre. Verified live on 2026-08-31: coordinate-carrying events commit, bare ones do not.
      const rect = suggestion.getBoundingClientRect();
      const mouse = { bubbles: true, cancelable: true, view: window, button: 0, clientX: Math.round(rect.left + rect.width / 2), clientY: Math.round(rect.top + rect.height / 2) };
      for (const type of ["mousemove", "mouseover", "mousedown", "mouseup", "click"]) {
        suggestion.dispatchEvent(new MouseEvent(type, mouse));
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
    },

    /**
     * The image field takes an https URL or a data URL: the page fetches it, wraps the bytes in
     * a File, and hands the File to Customily's own file input through a DataTransfer, so the
     * vendor's upload handler runs exactly as it does for a human pick. A cross-origin URL
     * without CORS headers fails the fetch; a data URL always works.
     */
    file_input: async function (field, value, signal) {
      const input = q(field.selectors.input);
      if (!input) return "control not found: " + field.selectors.input;
      const url = String(value);
      if (!/^(https:|data:image\/)/.test(url)) return "send an https URL or an image data URL";
      let blob;
      try {
        const res = await fetch(url, { signal: signal });
        if (!res.ok) return "fetching the image answered " + res.status;
        blob = await res.blob();
      } catch (err) {
        return "the image URL did not load from this page; send a data URL instead";
      }
      if (field.accept && field.accept.indexOf(blob.type) === -1) {
        return "the image type " + (blob.type || "unknown") + " is outside " + field.accept.join(", ");
      }
      const ext = (blob.type.split("/")[1] || "png").replace("jpeg", "jpg");
      const file = new File([blob], "personalization." + ext, { type: blob.type });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      fire(input, "input");
      fire(input, "change");
      return null;
    }
  };

  function previewState(adapter) {
    const canvas = q(adapter.preview.canvas);
    const container = canvas ? canvas.closest(".canvas-container") : null;
    const visible = !!(canvas && (canvas.offsetWidth || canvas.offsetHeight));
    const pending = !!(container && container.classList.contains(adapter.preview.pendingClass));
    return { present: !!canvas, ready: visible && !pending };
  }

  /* ---- batch validation (reads only) ---- */

  const DELIVERY_TYPES = ["single_address"];

  /** Issues with the delivery object; the object itself rides through the tools untouched. */
  function deliveryIssues(delivery) {
    const issues = [];
    if (!delivery || typeof delivery !== "object") {
      issues.push({ message: "delivery must be an object with type and address_ref" });
      return issues;
    }
    if (DELIVERY_TYPES.indexOf(delivery.type) === -1) {
      issues.push({ message: "delivery.type must be single_address" });
    }
    if (!delivery.address_ref || typeof delivery.address_ref !== "string") {
      issues.push({ message: "delivery.address_ref must be a non-empty string" });
    }
    return issues;
  }

  /**
   * The dry-run for one item: fields known, required fields present, value shapes and lengths,
   * variant resolvable, and, when this page is the product's own page, the field's control
   * rendered. Reads only; nothing on the page changes.
   */
  function itemIssues(adapter, productJson, item, onProductPage) {
    const issues = [];
    if (!item.recipient_ref || typeof item.recipient_ref !== "string") {
      issues.push({ message: "recipient_ref must be a non-empty string" });
    }
    if (!findVariant(productJson, item.variant_id)) {
      issues.push({ message: "variant_id " + JSON.stringify(String(item.variant_id)) + " matches none of this product's " + productJson.variants.length + " variants" });
    }
    const values = item.personalization || {};
    for (const key of Object.keys(values)) {
      const field = adapter.fields[key];
      if (!field) {
        issues.push({ field_key: key, message: "unknown field" });
        continue;
      }
      const value = values[key];
      if (typeof value !== "string" || value.length === 0) {
        issues.push({ field_key: key, message: "value must be a non-empty string" });
        continue;
      }
      if (field.max_length && value.length > field.max_length) {
        issues.push({ field_key: key, message: "value exceeds " + field.max_length + " characters" });
      }
      if (field.kind === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        issues.push({ field_key: key, message: "date must be YYYY-MM-DD" });
      }
      if (field.kind === "image" && !/^(https:|data:image\/)/.test(value)) {
        issues.push({ field_key: key, message: "send an https URL or an image data URL" });
      }
      if (onProductPage && !q(field.selectors.input)) {
        issues.push({ field_key: key, message: "control not rendered on this page: " + field.selectors.input });
      }
    }
    for (const key of Object.keys(adapter.fields)) {
      if (adapter.fields[key].required && values[key] === undefined) {
        issues.push({ field_key: key, message: "required and no value supplied" });
      }
    }
    return issues;
  }

  /** Validates the shared batch arguments; returns an isError result or null to proceed. */
  function batchArgIssues(args) {
    if (!PRODUCT_ADAPTERS[args.product_id]) {
      return fail("no personalization adapter for product " + JSON.stringify(String(args.product_id)), { known_product_ids: Object.keys(PRODUCT_ADAPTERS) });
    }
    if (!Array.isArray(args.items) || args.items.length === 0) {
      return fail("items must be a non-empty array");
    }
    const refs = new Set();
    for (const item of args.items) {
      if (item && item.recipient_ref) {
        if (refs.has(item.recipient_ref)) return fail("recipient_ref " + JSON.stringify(item.recipient_ref) + " appears twice in items");
        refs.add(item.recipient_ref);
      }
    }
    return null;
  }

  /* ---- idempotency (sessionStorage keyed to the idempotency_key) ---- */

  // The record is keyed on idempotency_key alone, not on the cart token: Shopify rotates the cart
  // token when the first line is added to an empty cart (verified live on 2026-08-31), so a
  // token-scoped key written before the first add is unfindable on the replay call. Cart identity
  // is instead re-checked on replay against the live cart lines (cartKeys.has below), so a cleared
  // or replaced cart re-adds rather than replaying a stale line.
  function idempotencyStorageKey(idempotencyKey) {
    return IDEMPOTENCY_PREFIX + idempotencyKey;
  }

  /** The recorded recipient-to-line map for this key, or an empty object. */
  function readIdempotencyRecord(idempotencyKey) {
    try {
      const raw = sessionStorage.getItem(idempotencyStorageKey(idempotencyKey));
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      return {};
    }
  }

  function writeIdempotencyRecord(idempotencyKey, record) {
    try {
      sessionStorage.setItem(idempotencyStorageKey(idempotencyKey), JSON.stringify(record));
    } catch (err) {
      // A full or blocked sessionStorage weakens the replay guard; the add itself already happened.
    }
  }

  async function fetchCart(signal) {
    try {
      const res = await fetch("/cart.js", { signal: signal });
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      return null;
    }
  }

  /* ---- tools ---- */

  const SCHEMA_ITEMS = {
    type: "array",
    description: "The personalized items of this batch",
    items: {
      type: "object",
      properties: {
        recipient_ref: { type: "string", description: "The caller's stable reference for the recipient this item belongs to" },
        variant_id: { type: "string", description: "The numeric Shopify variant id for this item" },
        personalization: { type: "object", description: "Field key to value, using the keys from get_personalization_schema" }
      },
      required: ["recipient_ref", "variant_id", "personalization"]
    }
  };

  const SCHEMA_DELIVERY = {
    type: "object",
    description: "The batch's delivery request; the storefront cannot set an address before checkout, so it rides through untouched for the caller",
    properties: {
      type: { type: "string", enum: ["single_address"], description: "The delivery mode of this batch" },
      address_ref: { type: "string", description: "The caller's reference for the destination address" }
    },
    required: ["type", "address_ref"]
  };

  const TOOLS = [
    {
      name: "get_personalization_schema",
      description:
        "Returns the personalization fields of a Customily product on this shop: each field's key, kind, label, control, and whether it is required, plus the product's variants when the storefront answers. An adapted product with no fields returns an empty field list. Call this before validate_personalized_batch.",
      inputSchema: {
        type: "object",
        properties: {
          product_id: { type: "string", description: "The numeric Shopify product id" }
        },
        required: ["product_id"],
        additionalProperties: false
      },
      execute: async function (args, options) {
        const signal = options ? options.signal : undefined;
        const adapter = PRODUCT_ADAPTERS[args.product_id];
        if (!adapter) return fail("no personalization adapter for product " + JSON.stringify(String(args.product_id)), { known_product_ids: Object.keys(PRODUCT_ADAPTERS) });
        const fields = Object.keys(adapter.fields).map(function (key) {
          const f = adapter.fields[key];
          return { key: key, kind: f.kind, label: f.label, control: f.control, required: !!f.required, notes: f.notes };
        });
        const payload = { product_id: String(args.product_id), title: adapter.title, fields: fields, variants: null };
        const productJson = await fetchProductJson(adapter, signal);
        if (productJson) {
          payload.variants = productJson.variants.map(function (v) { return { id: String(v.id), title: v.title }; });
        }
        const page = currentAdapter();
        if (page.productId === String(args.product_id) && page.adapter) {
          payload.current_variant_id = hiddenVariantId(adapter);
        }
        return result(payload);
      }
    },

    {
      name: "validate_personalized_batch",
      description:
        "Dry-runs a batch of personalized items against a product's adapter without changing the page: checks each item's recipient_ref, variant_id, field keys, required fields, value shapes, and, on the product's own page, that each field's control is rendered. Returns per-item issues; an empty issue list means create_personalized_batch can proceed.",
      inputSchema: {
        type: "object",
        properties: {
          product_id: { type: "string", description: "The numeric Shopify product id" },
          items: SCHEMA_ITEMS,
          delivery: SCHEMA_DELIVERY
        },
        required: ["product_id", "items", "delivery"],
        additionalProperties: false
      },
      execute: async function (args, options) {
        const signal = options ? options.signal : undefined;
        const argProblem = batchArgIssues(args);
        if (argProblem) return argProblem;
        const adapter = PRODUCT_ADAPTERS[args.product_id];
        const productJson = await fetchProductJson(adapter, signal);
        if (!productJson) return fail("the storefront's product JSON did not answer; retry from a page on the shop's origin");
        const onProductPage = currentAdapter().productId === String(args.product_id);
        const itemsOut = args.items.map(function (item) {
          const issues = itemIssues(adapter, productJson, item || {}, onProductPage);
          return { recipient_ref: item && item.recipient_ref ? item.recipient_ref : null, ok: issues.length === 0, issues: issues };
        });
        const dIssues = deliveryIssues(args.delivery);
        const valid = dIssues.length === 0 && itemsOut.every(function (i) { return i.ok; });
        return result({ product_id: String(args.product_id), valid: valid, items: itemsOut, delivery_issues: dIssues, delivery: args.delivery }, !valid);
      }
    },

    {
      name: "create_personalized_batch",
      description:
        "Configures and adds a whole batch of personalized items to the cart on this product page in one call: per item it selects the Shopify variant, fills each personalization field, waits for the Customily preview, and presses Customily's add-to-cart button. A repeated call with the same idempotency_key on the same cart adds no new lines. Returns batch_id, status, the ready and blocked items, the cart subtotal and currency, a checkout URL for this browser session's cart, and per-recipient preview URLs. Run validate_personalized_batch first.",
      inputSchema: {
        type: "object",
        properties: {
          batch_id: { type: "string", description: "The caller's stable id for this batch" },
          product_id: { type: "string", description: "The numeric Shopify product id; the current page must be this product's page" },
          items: SCHEMA_ITEMS,
          delivery: SCHEMA_DELIVERY,
          idempotency_key: { type: "string", description: "A caller-chosen key; a repeated call with the same key on the same cart re-adds nothing" }
        },
        required: ["batch_id", "product_id", "items", "delivery", "idempotency_key"],
        additionalProperties: false
      },
      execute: async function (args, options) {
        const signal = options ? options.signal : undefined;
        const argProblem = batchArgIssues(args);
        if (argProblem) return argProblem;
        if (!args.batch_id || !args.idempotency_key) return fail("batch_id and idempotency_key must be non-empty strings");
        const adapter = PRODUCT_ADAPTERS[args.product_id];
        const page = currentAdapter();
        if (page.productId !== String(args.product_id)) {
          return fail("this page is not the product's page; open the product page for " + args.product_id, { page_product_id: page.productId });
        }
        const dIssues = deliveryIssues(args.delivery);
        if (dIssues.length > 0) return fail("delivery is invalid", { delivery_issues: dIssues });
        const productJson = await fetchProductJson(adapter, signal);
        if (!productJson) return fail("the storefront's product JSON did not answer; retry");

        // The before-cart read fails as a result (#122): nothing has been clicked yet, so the
        // caller can retry without risking a double add.
        const cartBefore = await fetchCart(signal);
        if (!cartBefore) return fail("the cart did not answer with JSON before the add; retry");
        const record = readIdempotencyRecord(args.idempotency_key);
        const cartKeys = new Set(cartBefore.items.map(function (i) { return i.key; }));

        const ready = [];
        const blocked = [];
        for (const item of args.items) {
          const recipient = item && item.recipient_ref ? item.recipient_ref : "";
          // The idempotency record maps recipient_ref to its cart line; a recipient whose line
          // is already in the cart under this key is done, so a retry re-adds nothing.
          if (record[recipient] && cartKeys.has(record[recipient])) {
            ready.push({ recipient_ref: recipient, cart_line_key: record[recipient], replayed: true });
            continue;
          }
          const issues = itemIssues(adapter, productJson, item || {}, true);
          if (issues.length > 0) {
            blocked.push({ recipient_ref: recipient, issues: issues });
            continue;
          }
          const outcome = await produceItem(adapter, productJson, item, signal);
          if (outcome.error) {
            blocked.push({ recipient_ref: recipient, issues: [outcome.error] });
            continue;
          }
          record[recipient] = outcome.cart_line_key;
          cartKeys.add(outcome.cart_line_key);
          writeIdempotencyRecord(args.idempotency_key, record);
          ready.push({ recipient_ref: recipient, cart_line_key: outcome.cart_line_key, variant_id: outcome.variant_id });
        }

        const cartAfter = (await fetchCart(signal)) || cartBefore;
        const previewUrls = {};
        for (const entry of ready) {
          const line = cartAfter.items.find(function (i) { return i.key === entry.cart_line_key; });
          const preview = line && line.properties ? line.properties[PREVIEW_PROPERTY] : null;
          if (preview) previewUrls[entry.recipient_ref] = preview;
        }
        const payload = {
          batch_id: args.batch_id,
          status: "prepared",
          ready: ready,
          blocked: blocked,
          subtotal: cartAfter.items_subtotal_price,
          currency: cartAfter.currency,
          // The session cart's checkout entry; it works only in the browser session holding
          // this cart cookie, and the address is entered there because the storefront cannot
          // set one before checkout.
          checkout_url: location.origin + "/checkout",
          preview_urls: previewUrls,
          delivery: args.delivery
        };
        return result(payload, ready.length === 0);
      }
    }
  ];

  /**
   * Configures and adds one item: variant, fields, preview, Customily's cart button, then the
   * new cart line. Returns { cart_line_key, variant_id } or { error: { message } }; no throw
   * escapes to the tool body.
   */
  async function produceItem(adapter, productJson, item, signal) {
    const variant = await selectVariant(adapter, productJson, item.variant_id, signal);
    if (!variant.ok) return { error: { message: variant.error } };

    const values = item.personalization || {};
    for (const key of Object.keys(values)) {
      const field = adapter.fields[key];
      const problem = await CONTROLS[field.control](field, values[key], signal);
      if (problem) return { error: { field_key: key, message: problem } };
    }

    const previewReady = await waitFor(function () {
      return previewState(adapter).ready || null;
    }, adapter.preview.timeoutMs, signal);
    if (!previewReady) return { error: { message: "the Customily preview did not render in time" } };

    const button = q(adapter.cart.button);
    if (!button) return { error: { message: "Customily's add-to-cart button is not on this page" } };
    const before = await fetchCart(signal);
    if (!before) return { error: { message: "the cart did not answer with JSON before the add" } };
    const beforeKeys = new Set(before.items.map(function (i) { return i.key; }));
    button.click();
    const added = await waitForAsync(async function () {
      const cart = await fetchCart(signal);
      if (!cart) return null;
      return cart.items.find(function (i) { return !beforeKeys.has(i.key); }) || null;
    }, adapter.cart.settleMs, signal);
    if (!added) return { error: { message: "no new cart line appeared after pressing add to cart" } };
    return { cart_line_key: added.key, variant_id: String(added.variant_id) };
  }

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
