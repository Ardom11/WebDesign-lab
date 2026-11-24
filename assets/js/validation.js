/**
 * validation.js
 * Client-side validation for the site's forms (Vanilla JS, no dependencies).
 *
 * Supported forms (detected by their field names):
 *  - Contact form      → has [name="inquiry_type"]
 *  - Application form  → has [name="make_model"]
 *
 * UX model:
 *  - On page load nothing is validated and no errors are visible.
 *  - A field becomes "touched" when the user leaves it (blur), or changes a
 *    select / checkbox / file input. Blur performs the final validation.
 *  - Once a field is touched, every keystroke (input) re-validates it, so the
 *    error disappears / turns green as soon as the user fixes the problem.
 *  - Submit marks all fields as touched and validates everything.
 *  - Only when every field is valid, an accessible success modal opens.
 *
 * Phone field (application form) is auto-formatted while typing:
 *  - "0" or "0501234567"        → "+380 50 123 45 67" (local Ukrainian format)
 *  - "+380" / "380…"            → "+380 …"
 *  - spaces, brackets, dashes   → removed and re-formatted
 *  - letters and other symbols  → ignored
 *  - more than 9 digits after +380 → extra digits are cut off
 *  - deleting works anywhere in the number, including over a space
 *  - other countries (+49…, +1…) are kept as "+digits" (up to 15 digits)
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Configuration
   * ------------------------------------------------------------------ */

  // Simple, practical email pattern: something@something.tld
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  // Minimum lengths (validation rules)
  const MIN_NAME = 2;
  const MIN_OPTIONAL_TEXT = 2; // optional text fields: min length if filled in
  const MIN_CITY = 2;
  const MIN_MAKE_MODEL = 2;
  const MIN_SUBJECT = 5;
  const MIN_MESSAGE = 10;
  const MIN_STORY = 10;

  // Vehicle year: the first car was built in 1886
  const MIN_YEAR = 1886;

  // Photos (matches the hint under the upload field)
  const MAX_PHOTOS = 5;
  const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10 MB
  const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png'];

  // Phone
  const UA_CODE = '380';
  const UA_LOCAL_DIGITS = 9; // digits after +380
  const INTL_MIN_DIGITS = 8; // other countries: total digits incl. country code
  const INTL_MAX_DIGITS = 15; // E.164 maximum

  // Tailwind classes used for the visual states
  const ERROR_BORDER = 'border-red-500';
  const SUCCESS_BORDER = 'border-green-500';

  // Matches a border *colour* class (border-line, border-accent-brass …) but not
  // width / style / side classes (border, border-t, border-2, border-dashed …)
  // and not our own state classes.
  const BASE_BORDER_COLOR_CLASS =
    /^border-(?!red-500$|green-500$)(?!(?:[trblxyse]|\d+|dashed|solid|dotted|double|hidden|none|collapse|separate|spacing)(?:-|$))/;

  // Attribute marking a field the user has not interacted with yet
  const UNTOUCHED_ATTR = 'data-untouched';

  /* ------------------------------------------------------------------ *
   * Shared text helpers
   * ------------------------------------------------------------------ */

  /** "Subject must be at least 5 characters (you have 3 so far)" */
  function tooShortMessage(label, min, length) {
    return (
      label + ' must be at least ' + min + ' characters (you have ' + length + ' so far)'
    );
  }

  /** Required text: empty → friendly prompt, too short → length hint. */
  function checkRequiredText(field, emptyMessage, label, min) {
    const length = field.value.trim().length;
    if (length === 0) return emptyMessage;
    if (length < min) return tooShortMessage(label, min, length);
    return '';
  }

  /** Optional text: blank is fine, but if filled it needs a minimum length. */
  function checkOptionalText(field, label, min) {
    const length = field.value.trim().length;
    if (length === 0) return '';
    if (length < min) {
      return label + ' must be at least ' + min + ' characters, or leave it blank';
    }
    return '';
  }

  /** Select: the placeholder option (empty value) is not a valid choice. */
  function checkSelected(field, message) {
    return field.value !== '' ? '' : message;
  }

  /* ------------------------------------------------------------------ *
   * Field validators
   * Each returns an error message (string), or '' when the field is valid.
   * ------------------------------------------------------------------ */

  /* ---- Shared by both forms ---- */

  /** Name: at least 2 characters. */
  function validateName(field) {
    return checkRequiredText(field, 'Please enter your full name', 'Name', MIN_NAME);
  }

  /** Email: must match a basic email format. */
  function validateEmail(field) {
    const value = field.value.trim();
    if (value === '') return 'Please enter your email address';
    if (!EMAIL_PATTERN.test(value)) {
      return 'Enter a valid email address, for example name@example.com';
    }
    return '';
  }

  /* ---- Contact form ---- */

  /** Organisation: optional, at least 2 characters if filled. */
  function validateOrganisation(field) {
    return checkOptionalText(field, 'Organisation name', MIN_OPTIONAL_TEXT);
  }

  /** Inquiry type: an actual option must be selected. */
  function validateInquiryType(field) {
    return checkSelected(field, 'Please choose a topic from the list');
  }

  /** Subject: at least 5 characters. */
  function validateSubject(field) {
    return checkRequiredText(field, 'Please enter a short subject', 'Subject', MIN_SUBJECT);
  }

  /** Message: at least 10 characters. */
  function validateMessage(field) {
    return checkRequiredText(
      field, 'Please tell us how we can help', 'Message', MIN_MESSAGE
    );
  }

  /** Consent (contact form): checkbox must be ticked. */
  function validateConsent(field) {
    return field.checked
      ? ''
      : 'Please tick the box so we can use your details to reply';
  }

  /* ---- Application form ---- */

  /** Phone: +380 followed by 9 digits, or another country code + number. */
  function validatePhone(field) {
    const normalized = parsePhone(field.value); // e.g. "+380501234567"
    const digits = normalized.slice(1);

    if (digits === '') return 'Please enter your phone number';

    if (digits.indexOf(UA_CODE) === 0) {
      const localDigits = digits.length - UA_CODE.length;
      if (localDigits < UA_LOCAL_DIGITS) {
        return (
          'Ukrainian numbers need ' + UA_LOCAL_DIGITS + ' digits after +' + UA_CODE +
          ' (you have ' + localDigits + ' so far)'
        );
      }
      return '';
    }

    if (digits.length < INTL_MIN_DIGITS) {
      return 'Enter your number with the country code, for example +380 50 123 45 67';
    }
    return '';
  }

  /** City / country: at least 2 characters. */
  function validateCity(field) {
    return checkRequiredText(
      field, 'Please tell us where you are based', 'City / country', MIN_CITY
    );
  }

  /** Make & model: at least 2 characters. */
  function validateMakeModel(field) {
    return checkRequiredText(
      field, 'Please enter the make and model of your vehicle', 'Make & model', MIN_MAKE_MODEL
    );
  }

  /** Year: 4 digits, between the first car and next year. */
  function validateYear(field) {
    const value = field.value.trim();
    if (value === '') return 'Please enter the year of your vehicle';
    if (!/^\d{4}$/.test(value)) return 'Enter the year as 4 digits, for example 1998';

    const year = Number(value);
    const maxYear = new Date().getFullYear() + 1;
    if (year < MIN_YEAR || year > maxYear) {
      return 'Year must be between ' + MIN_YEAR + ' and ' + maxYear;
    }
    return '';
  }

  /** Build category: an actual option must be selected. */
  function validateCategory(field) {
    return checkSelected(field, 'Please choose a build category');
  }

  /** Club / social profile: optional, at least 2 characters if filled. */
  function validateClub(field) {
    return checkOptionalText(field, 'Club / profile', MIN_OPTIONAL_TEXT);
  }

  /** Story: at least 10 characters. */
  function validateStory(field) {
    return checkRequiredText(
      field, 'Please tell us about your build', 'Your description', MIN_STORY
    );
  }

  /** Photos: 1–5 files, JPG / PNG only, up to 10 MB each. */
  function validatePhotos(field) {
    const files = Array.from(field.files || []);

    if (files.length === 0) return 'Please add at least one photo of your vehicle';
    if (files.length > MAX_PHOTOS) {
      return 'You can upload up to ' + MAX_PHOTOS + ' photos (you selected ' + files.length + ')';
    }

    const wrongType = files.find(function (file) {
      return ALLOWED_PHOTO_TYPES.indexOf(file.type) === -1;
    });
    if (wrongType) return '"' + wrongType.name + '" is not a JPG or PNG image';

    const tooBig = files.find(function (file) {
      return file.size > MAX_PHOTO_BYTES;
    });
    if (tooBig) return '"' + tooBig.name + '" is larger than 10 MB';

    return '';
  }

  /** Event: an actual option must be selected. */
  function validateEvent(field) {
    return checkSelected(field, 'Please choose an event');
  }

  /** Participation type: an actual option must be selected. */
  function validateParticipationType(field) {
    return checkSelected(field, 'Please choose how you would like to take part');
  }

  /** Additional notes: optional, at least 2 characters if filled. */
  function validateNotes(field) {
    return checkOptionalText(field, 'Notes', MIN_OPTIONAL_TEXT);
  }

  /** Consent (application form): checkbox must be ticked. */
  function validateRulesConsent(field) {
    return field.checked
      ? ''
      : 'Please tick the box to agree to the rules and let us review your application';
  }

  /* ------------------------------------------------------------------ *
   * Input formatters (run while typing and on blur)
   * ------------------------------------------------------------------ */

  /** Counts digits in a string. */
  function countDigits(text) {
    return text.replace(/\D/g, '').length;
  }

  /**
   * Turns whatever the user typed or pasted into a clean "+digits" string.
   * Handles: letters, spaces, brackets, dashes, a leading 0 (local format),
   * "00" international prefix, an extra 0 after +380, and too many digits.
   */
  function parsePhone(raw) {
    const trimmed = raw.trim();
    const hasPlus = trimmed.charAt(0) === '+';
    let digits = raw.replace(/\D/g, ''); // drops letters, spaces, (), -, etc.

    if (digits === '') return hasPlus ? '+' : '';

    if (!hasPlus) {
      if (digits.indexOf('00') === 0) {
        digits = digits.slice(2); // 00380… → 380…
      } else if (digits.charAt(0) === '0') {
        digits = UA_CODE + digits.slice(1); // 050… → 38050…
      }
    }

    if (digits.indexOf(UA_CODE) === 0) {
      // "+380 0 50…": the local 0 after the country code is not needed
      if (digits.charAt(UA_CODE.length) === '0') {
        digits = UA_CODE + digits.slice(UA_CODE.length + 1);
      }
      digits = digits.slice(0, UA_CODE.length + UA_LOCAL_DIGITS); // cut extra digits
    } else {
      digits = digits.slice(0, INTL_MAX_DIGITS);
    }

    return '+' + digits;
  }

  /** Adds spaces: Ukrainian numbers become "+380 50 123 45 67". */
  function formatPhone(normalized) {
    if (normalized.indexOf('+' + UA_CODE) !== 0) return normalized;

    const local = normalized.slice(UA_CODE.length + 1);
    const groups = [
      local.slice(0, 2),
      local.slice(2, 5),
      local.slice(5, 7),
      local.slice(7, 9),
    ].filter(Boolean);

    return ['+' + UA_CODE].concat(groups).join(' ');
  }

  /** Caret position in `formatted` right after the n-th digit. */
  function caretAfterDigits(formatted, digitCount) {
    if (digitCount <= 0) return formatted.charAt(0) === '+' ? 1 : 0;

    let seen = 0;
    for (let i = 0; i < formatted.length; i++) {
      if (/\d/.test(formatted.charAt(i))) seen++;
      if (seen === digitCount) return i + 1;
    }
    return formatted.length;
  }

  /**
   * Formats the phone field as the user types (event.type === 'input')
   * or when they leave it / submit (event.type === 'blur').
   */
  function formatPhoneField(field, event) {
    const isTyping = event.type === 'input';
    if (isTyping && event.isComposing) return; // don't fight an IME

    const raw = field.value;
    const caret = typeof field.selectionStart === 'number' ? field.selectionStart : raw.length;
    let keepCaretAtEnd = caret >= raw.length;
    let digitsBeforeCaret = countDigits(raw.slice(0, caret));

    let normalized = parsePhone(raw);
    let formatted = formatPhone(normalized);

    // Deleting a space (or other separator) changes nothing after re-formatting,
    // so the user would be stuck. In that case delete the neighbouring digit.
    const previous = field.dataset.fvPrev || '';
    const isBackspace = isTyping && event.inputType === 'deleteContentBackward';
    const isDelete = isTyping && event.inputType === 'deleteContentForward';

    if ((isBackspace || isDelete) && previous !== '' && formatted === previous) {
      const digits = normalized.slice(1);
      const index = isBackspace ? digitsBeforeCaret - 1 : digitsBeforeCaret;

      if (index >= 0 && index < digits.length) {
        normalized = parsePhone('+' + digits.slice(0, index) + digits.slice(index + 1));
        formatted = formatPhone(normalized);
        if (isBackspace) digitsBeforeCaret -= 1;
        keepCaretAtEnd = false;
      }
    }

    // A lone "+" is not a number: clear it when the user leaves the field
    if (!isTyping && formatted === '+') formatted = '';

    if (field.value !== formatted) {
      field.value = formatted;

      // Editing in the middle: put the caret back after the same digit
      if (isTyping && !keepCaretAtEnd && document.activeElement === field) {
        const position = caretAfterDigits(formatted, digitsBeforeCaret);
        try {
          field.setSelectionRange(position, position);
        } catch (error) {
          /* some input types don't support selection: ignore */
        }
      }
    }

    field.dataset.fvPrev = formatted;
  }

  /** Year field: digits only, max 4. */
  function formatYearField(field) {
    const cleaned = field.value.replace(/\D/g, '').slice(0, 4);
    if (field.value !== cleaned) field.value = cleaned;
  }

  /* ------------------------------------------------------------------ *
   * UI helpers: error text and border states
   * ------------------------------------------------------------------ */

  /** Gives a field an id (derived from its name) if the markup has none. */
  function ensureId(field) {
    if (!field.id) field.id = field.name;
  }

  /** Adds the error element's id to the field's aria-describedby. */
  function linkDescription(field, errorId) {
    const ids = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    if (ids.indexOf(errorId) === -1) {
      ids.push(errorId);
      field.setAttribute('aria-describedby', ids.join(' '));
    }
  }

  /** Creates an error <p> in a sensible place for the field type. */
  function createErrorElement(field, errorId) {
    const el = createElement('p', 'hidden text-xs leading-normal text-red-500', {
      id: errorId,
      'aria-live': 'polite',
    });
    el.dataset.fvDynamic = 'true'; // created by us: toggled with "hidden"

    if (field.type === 'checkbox') {
      const label = field.closest('label');
      if (label) {
        // Checkbox wrapped in a label inside a roomy flex column: tuck the
        // message close under the label
        el.classList.add('-mt-6');
        label.insertAdjacentElement('afterend', el);
      } else {
        // Checkbox in its own full-width row
        el.classList.add('col-span-full');
        field.parentElement.insertAdjacentElement('afterend', el);
      }
    } else if (field.type === 'file') {
      // The input is visually hidden inside the drop zone label: put the
      // message under the drop zone
      const zone = field.closest('label');
      (zone ? zone.parentElement : field.parentElement).appendChild(el);
    } else {
      field.parentElement.appendChild(el);
    }
    return el;
  }

  /** Finds the field's error <p> (id + "Error"), or creates one. */
  function getErrorElement(field) {
    const errorId = field.id + 'Error';
    const el = document.getElementById(errorId) || createErrorElement(field, errorId);
    linkDescription(field, errorId);
    return el;
  }

  /** Shows (message) or hides ('') the error text under a field. */
  function toggleErrorText(field, message) {
    const el = getErrorElement(field);
    const show = message !== '';

    if (show) el.textContent = message;

    if (el.dataset.fvDynamic) {
      el.classList.toggle('hidden', !show);
    } else {
      // Markup-provided <p>: it reserves space, so toggle visibility instead
      el.classList.toggle('invisible', !show);
      el.classList.toggle('visible', show);
      el.classList.toggle('text-red-500', show); // markup has a typo'd colour class
    }
  }

  /** The element that carries the border: the drop zone for file inputs. */
  function getBorderTarget(field) {
    if (field.type === 'file') return field.closest('label') || field;
    return field;
  }

  /**
   * Temporarily removes the element's own border-colour class (border-line,
   * border-accent-brass …) so it cannot override our red / green border.
   */
  function stashBaseBorder(target) {
    if (target.dataset.fvBaseBorder !== undefined) return;
    const base = Array.from(target.classList).filter(function (cls) {
      return BASE_BORDER_COLOR_CLASS.test(cls);
    });
    target.dataset.fvBaseBorder = base.join(' ');
    base.forEach(function (cls) { target.classList.remove(cls); });
  }

  /** Puts the original border-colour class back (neutral state). */
  function restoreBaseBorder(target) {
    if (target.dataset.fvBaseBorder === undefined) return;
    target.dataset.fvBaseBorder.split(' ').filter(Boolean).forEach(function (cls) {
      target.classList.add(cls);
    });
    delete target.dataset.fvBaseBorder;
  }

  /** Error state: red border + message. */
  function setInvalid(field, message) {
    const target = getBorderTarget(field);
    stashBaseBorder(target);
    target.classList.remove(SUCCESS_BORDER);
    target.classList.add(ERROR_BORDER);
    field.setAttribute('aria-invalid', 'true');
    toggleErrorText(field, message);
  }

  /** Success state: green border, no message. */
  function setValid(field) {
    const target = getBorderTarget(field);
    stashBaseBorder(target);
    target.classList.remove(ERROR_BORDER);
    target.classList.add(SUCCESS_BORDER);
    field.setAttribute('aria-invalid', 'false');
    toggleErrorText(field, '');
  }

  /** Neutral state: original look, no message. */
  function setNeutral(field) {
    const target = getBorderTarget(field);
    target.classList.remove(ERROR_BORDER, SUCCESS_BORDER);
    restoreBaseBorder(target);
    field.removeAttribute('aria-invalid');
    toggleErrorText(field, '');
  }

  /* ------------------------------------------------------------------ *
   * "Touched" state
   * ------------------------------------------------------------------ */

  function isTouched(field) {
    return !field.hasAttribute(UNTOUCHED_ATTR);
  }

  function markTouched(field) {
    field.removeAttribute(UNTOUCHED_ATTR);
  }

  function markUntouched(field) {
    field.setAttribute(UNTOUCHED_ATTR, '');
  }

  /* ------------------------------------------------------------------ *
   * Suppress native :invalid styling until the field is touched
   *
   * Only needed when the markup styles the browser's :invalid state
   * (classes like "invalid:border-red-500" / "peer-invalid:visible"), which
   * is true for empty required fields right after page load. Forms that use
   * :user-invalid instead already wait for user interaction and don't need it.
   * The neutral colours are measured from a hidden clone of the field without
   * its invalid:* classes, so they match the theme.
   * ------------------------------------------------------------------ */

  /** True if the field's classes react to the native :invalid state. */
  function usesNativeInvalidStyles(field) {
    return /(^|\s)invalid:/.test(field.className);
  }

  /** Measures the field's normal (non-invalid) border and text colour. */
  function measureNeutralColors(field) {
    const probe = field.cloneNode(false);
    probe.removeAttribute('id');
    probe.removeAttribute('name');
    probe.removeAttribute('required');
    probe.setAttribute('aria-hidden', 'true');
    probe.tabIndex = -1;
    probe.className = Array.from(field.classList)
      .filter(function (cls) { return cls.indexOf('invalid:') !== 0; })
      .join(' ');
    probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;';

    field.parentElement.appendChild(probe);
    const styles = window.getComputedStyle(probe);
    const colors = { border: styles.borderTopColor, text: styles.color };
    probe.remove();
    return colors;
  }

  /** Injects the override stylesheet (once per page). */
  function injectUntouchedStyles() {
    if (document.getElementById('form-validation-ux')) return;

    const style = document.createElement('style');
    style.id = 'form-validation-ux';
    style.textContent =
      // Untouched + natively invalid: show the normal border/text colour
      'form [' + UNTOUCHED_ATTR + ']:invalid {' +
      '  border-color: var(--fv-border);' +
      '  color: var(--fv-text);' +
      '}' +
      // Untouched + natively invalid: hide the peer-invalid error text
      'form .peer[' + UNTOUCHED_ATTR + ']:invalid ~ p { visibility: hidden; }';
    document.head.appendChild(style);
  }

  /** Stores each field's neutral colours as CSS variables used above. */
  function applyNeutralColors(fields) {
    fields.forEach(function (field) {
      const colors = measureNeutralColors(field);
      field.style.setProperty('--fv-border', colors.border);
      field.style.setProperty('--fv-text', colors.text);
    });
  }

  /* ------------------------------------------------------------------ *
   * Validation orchestration
   * A "rule" is { field, validate, optional, format }.
   * ------------------------------------------------------------------ */

  /**
   * Validates one field and updates its UI.
   * Returns true if the field is valid.
   */
  function validateField(rule) {
    const field = rule.field;
    const message = rule.validate(field);

    if (message) {
      setInvalid(field, message);
      return false;
    }

    // Optional field left blank → neutral rather than "success"
    if (rule.optional && field.value.trim() === '') {
      setNeutral(field);
    } else {
      setValid(field);
    }
    return true;
  }

  /** Marks a field as touched, formats it, then validates it (blur / change / submit). */
  function touchAndValidate(rule) {
    markTouched(rule.field);
    if (rule.format) rule.format(rule.field, { type: 'blur' });
    return validateField(rule);
  }

  /** Live update while typing: only once the field has been touched. */
  function validateIfTouched(rule) {
    if (isTouched(rule.field)) validateField(rule);
  }

  /** Submit: touches and validates every field; returns the invalid fields. */
  function validateAll(rules) {
    return rules
      .filter(function (rule) { return !touchAndValidate(rule); })
      .map(function (rule) { return rule.field; });
  }

  /* ------------------------------------------------------------------ *
   * Event wiring
   * ------------------------------------------------------------------ */

  /** Attaches blur / input / change handlers for one field. */
  function bindFieldEvents(rule) {
    const field = rule.field;

    // Leaving the field = final validation of that field
    field.addEventListener('blur', function () {
      touchAndValidate(rule);
    });

    // Typing = format first, then refresh state (only after the first blur)
    field.addEventListener('input', function (event) {
      if (rule.format) rule.format(field, event);
      validateIfTouched(rule);
    });

    // Select / checkbox / file: a choice is a complete interaction
    if (field.tagName === 'SELECT' || field.type === 'checkbox' || field.type === 'file') {
      field.addEventListener('change', function () {
        touchAndValidate(rule);
      });
    }
  }

  /** Brings the form back to its initial "nothing validated" state. */
  function resetFormState(rules) {
    rules.forEach(function (rule) {
      markUntouched(rule.field);
      delete rule.field.dataset.fvPrev;
      setNeutral(rule.field);
    });
  }

  /** Focuses a field and scrolls it into view. */
  function focusField(field) {
    field.focus();
    field.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  /* ------------------------------------------------------------------ *
   * Success modal (accessible dialog, built with Tailwind classes)
   *
   * - role="dialog" + aria-modal, labelled by its title and description
   * - fixed, centred, with a dark backdrop
   * - closes with the X button, the "Close" button, Escape or a backdrop click
   * - focus moves into the dialog, is trapped there (Tab / Shift+Tab) and
   *   returns to the element that opened it on close
   * - the rest of the page is made inert and scrolling is locked while open
   * ------------------------------------------------------------------ */

  const FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
    'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  // Shared focus ring for the modal's buttons (focus-visible only)
  const FOCUS_RING =
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ' +
    'focus-visible:outline-accent-brass';

  // Holds everything about the currently open modal, or null when closed
  let modalState = null;

  /** Small helper: creates an element with classes and attributes. */
  function createElement(tag, className, attributes) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    Object.keys(attributes || {}).forEach(function (name) {
      el.setAttribute(name, attributes[name]);
    });
    return el;
  }

  /** Builds the green "check" icon (decorative, hidden from screen readers). */
  function buildSuccessIcon() {
    const wrapper = createElement(
      'div',
      'mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-600',
      { 'aria-hidden': 'true' }
    );
    wrapper.innerHTML =
      '<svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M5 13l4 4L19 7"/></svg>';
    return wrapper;
  }

  /** Builds the "×" button in the top-right corner. */
  function buildCloseIconButton() {
    const button = createElement(
      'button',
      'absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-xs ' +
        'text-2xl leading-none text-content-secondary transition-colors ' +
        'hover:text-content-main ' + FOCUS_RING,
      { type: 'button', 'aria-label': 'Close dialog' }
    );
    button.innerHTML = '<span aria-hidden="true">&times;</span>';
    return button;
  }

  /** Builds the whole modal DOM and returns references to the parts we need. */
  function buildSuccessModal(titleText) {
    const titleId = 'form-success-title';
    const descriptionId = 'form-success-description';

    // Backdrop: fixed, full screen, dark, content centred
    const overlay = createElement(
      'div',
      'fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4'
    );

    // Dialog box: centred card
    const dialog = createElement(
      'div',
      'relative w-full max-w-md rounded-xs bg-surface-light p-6 shadow-xl outline-none sm:p-8',
      {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': titleId,
        'aria-describedby': descriptionId,
        tabindex: '-1',
      }
    );

    const closeIconButton = buildCloseIconButton();

    const title = createElement(
      'h2',
      'text-xl font-semibold leading-ui text-content-main',
      { id: titleId }
    );
    title.textContent = titleText;

    const description = createElement(
      'p',
      'mt-2 text-sm leading-normal text-content-secondary',
      { id: descriptionId }
    );

    const closeButton = createElement(
      'button',
      'button button-primary mt-6 w-full sm:w-auto ' + FOCUS_RING,
      { type: 'button' }
    );
    closeButton.textContent = 'Close';

    dialog.append(buildSuccessIcon(), closeIconButton, title, description, closeButton);
    overlay.appendChild(dialog);

    return {
      overlay: overlay,
      dialog: dialog,
      description: description,
      closeButtons: [closeIconButton, closeButton],
    };
  }

  /** True while the success modal is on screen. */
  function isSuccessModalOpen() {
    return modalState !== null;
  }

  /** Makes everything behind the modal unreachable (mouse, keyboard, AT). */
  function hideBackground(overlay) {
    const hidden = [];
    Array.from(document.body.children).forEach(function (child) {
      if (child !== overlay && !child.hasAttribute('inert')) {
        child.setAttribute('inert', '');
        hidden.push(child);
      }
    });
    return hidden;
  }

  /** Keeps Tab / Shift+Tab cycling inside the dialog. */
  function trapFocus(event) {
    const dialog = modalState.dialog;
    const focusable = Array.from(dialog.querySelectorAll(FOCUSABLE_SELECTOR));
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    // Focus is on the dialog itself (or outside): enter the loop
    if (active === dialog || !dialog.contains(active)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return;
    }

    // Wrap around at the edges
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /** Document-level keyboard handling while the modal is open. */
  function handleModalKeydown(event) {
    if (!modalState) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      closeSuccessModal();
    } else if (event.key === 'Tab') {
      trapFocus(event);
    }
  }

  /**
   * Opens the success modal.
   * options: { title, text, trigger (element to refocus), onClose (callback) }
   */
  function openSuccessModal(options) {
    if (modalState) return;

    const ui = buildSuccessModal(options.title);

    // textContent (not innerHTML) so user input can never inject markup
    ui.description.textContent = options.text;

    document.body.appendChild(ui.overlay);

    modalState = {
      overlay: ui.overlay,
      dialog: ui.dialog,
      trigger: options.trigger,
      onClose: options.onClose,
      inertElements: hideBackground(ui.overlay),
      scrollWasLocked: document.body.classList.contains('overflow-hidden'),
    };

    // Lock background scrolling
    document.body.classList.add('overflow-hidden');

    // Close via both buttons
    ui.closeButtons.forEach(function (button) {
      button.addEventListener('click', closeSuccessModal);
    });

    // Close by clicking the dark backdrop (but not the dialog itself)
    ui.overlay.addEventListener('mousedown', function (event) {
      if (event.target === ui.overlay) closeSuccessModal();
    });

    document.addEventListener('keydown', handleModalKeydown);

    // Move focus into the dialog so screen readers announce its content
    ui.dialog.focus();
  }

  /** Closes the modal and restores page state and focus. */
  function closeSuccessModal() {
    if (!modalState) return;

    const state = modalState;
    modalState = null;

    document.removeEventListener('keydown', handleModalKeydown);
    state.overlay.remove();

    // Make the page interactive again
    state.inertElements.forEach(function (el) {
      el.removeAttribute('inert');
    });
    if (!state.scrollWasLocked) document.body.classList.remove('overflow-hidden');

    if (typeof state.onClose === 'function') state.onClose();

    // Return focus to whatever opened the dialog (the submit button)
    if (state.trigger && document.contains(state.trigger)) state.trigger.focus();
  }

  /* ------------------------------------------------------------------ *
   * Form definitions
   * Each spec: { name (form control name), validate, optional?, format? }
   * Order = order on the page (the first invalid field gets focus).
   * ------------------------------------------------------------------ */

  /** "Thank you, Anna. We have received your message and will reply to a@b.c soon." */
  function composeThanks(name, received, followUp, email) {
    return (
      'Thank you' + (name ? ', ' + name : '') + '. We have received your ' + received +
      (email ? ' and will ' + followUp + ' ' + email : '') + ' soon.'
    );
  }

  const CONTACT_FORM = {
    detectBy: 'inquiry_type',
    successTitle: 'Message sent successfully',
    successText: function (name, email) {
      return composeThanks(name, 'message', 'reply to', email);
    },
    fields: [
      { name: 'full_name', validate: validateName },
      { name: 'email', validate: validateEmail },
      { name: 'organisation', validate: validateOrganisation, optional: true },
      { name: 'inquiry_type', validate: validateInquiryType },
      { name: 'subject', validate: validateSubject },
      { name: 'message', validate: validateMessage },
      { name: 'consent', validate: validateConsent },
    ],
  };

  const APPLICATION_FORM = {
    detectBy: 'make_model',
    successTitle: 'Application submitted',
    successText: function (name, email) {
      return composeThanks(name, 'application', 'contact you at', email);
    },
    fields: [
      { name: 'full_name', validate: validateName },
      { name: 'email', validate: validateEmail },
      { name: 'phone', validate: validatePhone, format: formatPhoneField },
      { name: 'city', validate: validateCity },
      { name: 'make_model', validate: validateMakeModel },
      { name: 'year', validate: validateYear, format: formatYearField },
      { name: 'category', validate: validateCategory },
      { name: 'club', validate: validateClub, optional: true },
      { name: 'story', validate: validateStory },
      { name: 'photos', validate: validatePhotos },
      { name: 'event', validate: validateEvent },
      { name: 'participation_type', validate: validateParticipationType },
      { name: 'notes', validate: validateNotes, optional: true },
      { name: 'consent', validate: validateRulesConsent },
    ],
  };

  /* ------------------------------------------------------------------ *
   * Setup
   * ------------------------------------------------------------------ */

  /** Reads a trimmed value from a named control (or '' if it doesn't exist). */
  function readValue(form, name) {
    const control = form.elements.namedItem(name);
    return control && control.value ? control.value.trim() : '';
  }

  /** Wires validation, touched-state handling and the success modal to a form. */
  function setupForm(form, config) {
    // Disable the browser's built-in bubbles so our messages are used
    form.noValidate = true;

    // Resolve each spec to a rule holding its field (skip missing controls)
    const rules = config.fields
      .map(function (spec) {
        return {
          field: form.elements.namedItem(spec.name),
          validate: spec.validate,
          optional: Boolean(spec.optional),
          format: spec.format,
        };
      })
      .filter(function (rule) { return rule.field; });

    const fields = rules.map(function (rule) { return rule.field; });
    fields.forEach(ensureId);

    // Start clean: every field untouched
    if (fields.some(usesNativeInvalidStyles)) {
      injectUntouchedStyles();
      applyNeutralColors(fields);
    }
    fields.forEach(markUntouched);

    rules.forEach(bindFieldEvents);

    // Form reset → forget touched state and clear all messages
    form.addEventListener('reset', function () {
      resetFormState(rules);
    });

    // Intercept submit
    form.addEventListener('submit', function (event) {
      event.preventDefault(); // always stop the default submit first

      const invalidFields = validateAll(rules);

      if (invalidFields.length > 0) {
        // At least one field is invalid: don't submit, jump to the first problem
        focusField(invalidFields[0]);
        return;
      }

      // Everything is valid. If the modal is already open, do nothing.
      if (isSuccessModalOpen()) return;

      // TODO: send the data to your backend here (e.g. fetch(form.action, {
      // method: 'POST', body: new FormData(form) })) and open the modal only
      // after the request succeeds. The native form.submit() is intentionally
      // not used: with action="#" it would reload the page.
      openSuccessModal({
        title: config.successTitle,
        text: config.successText(readValue(form, 'full_name'), readValue(form, 'email')),
        trigger: event.submitter || document.activeElement,
        // After the modal closes, return the form to its initial empty state
        onClose: function () {
          form.reset();
        },
      });
    });
  }

  function init() {
    [CONTACT_FORM, APPLICATION_FORM].forEach(function (config) {
      Array.from(document.forms).forEach(function (form) {
        if (form.elements.namedItem(config.detectBy)) setupForm(form, config);
      });
    });
  }

  // Run once the DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();