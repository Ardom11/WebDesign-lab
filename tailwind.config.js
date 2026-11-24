/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./**/*.{html,js}"],

  theme: {
    extend: {
      /* ---------- Colors ---------- */
      colors: {
        primary: {
          navy: "#142b4a",
          bone: "#f4f0e6",
        },
        accent: {
          brass: "#a6824a",
          "brass-hover": "#8e6b38",
          "brass-tint": "#f2e8d3",
        },
        // Page backgrounds (was --color-bg-*)
        canvas: {
          light: "#faf8f3",
          warm: "#f4f0e6",
          dark: "#142b4a",
          deep: "#0f2138",
        },
        // Cards / inputs (was --color-surface-*)
        surface: {
          light: "#ffffff",
          "light-alt": "#fcfaf5",
          dark: "#1b3554",
          "dark-alt": "#203c5e",
        },
        // Text (was --color-text-*). Default = on light, inverse = on dark.
        content: {
          main: "#142b4a",
          secondary: "#5c6b7a",
          disabled: "#9aa5b1",
          link: "#a6824a",
          inverse: {
            DEFAULT: "#f4f0e6",
            secondary: "#b8c2ce",
            disabled: "#6e7f93",
            link: "#d4b679",
          },
        },
        success: { fg: "#5c7a5e", bg: "#e8eee7" },
        warning: { fg: "#b8864b", bg: "#f5eadc" },
        error: { fg: "#a14b42", bg: "#f2e2df" },
        line: "#e4decf", // was --color-border
        placeholder: "#ebebeb",
      },

      borderColor: {
        DEFAULT: "#e4decf",
      },

      /* ---------- Typography ---------- */
      fontFamily: {
        display: ['"Fraunces"', "serif"],
        sans: ['"Inter"', "sans-serif"],
      },
      lineHeight: {
        headline: "1.1",
        ui: "1.4",
        body: "1.6",
      },
      letterSpacing: {
        label: "1.8px",
        eyebrow: "0.06em",
        brand: "0.04em",
      },

      /* ---------- Radii & shadows ---------- */
      borderRadius: {
        xs: "2px",
        sm: "6px",
        md: "10px",
        lg: "18px",
        full: "999px",
      },
      boxShadow: {
        xs: "0 1px 2px rgba(20, 43, 74, 0.06)",
        sm: "0 2px 8px rgba(20, 43, 74, 0.08)",
        md: "0 8px 24px rgba(20, 43, 74, 0.1)",
        lg: "0 16px 48px rgba(20, 43, 74, 0.14)",
      },

      /* ---------- Spacing & layout ---------- */
      // The old --space-1..10 scale and --space-tight (10px = 2.5)
      // already match Tailwind's default spacing scale.
      spacing: {
        13: "52px", // button height, header logo
        18: "72px",
        // Responsive tokens, values switch per breakpoint in input.css
        gutter: "var(--container-padding-x)", // 24 / 40 / 72
        section: "var(--section-padding-y)", // 48 / 72 / 96
        grid: "var(--grid-gap)", // 20 / 24 / 32
      },
      maxWidth: {
        container: "1296px",
        narrow: "640px",
      },

      /* ---------- Motion ---------- */
      // Durations are CSS variables so prefers-reduced-motion can zero them.
      transitionDuration: {
        fast: "var(--transition-duration-fast)",
        base: "var(--transition-duration-base)",
        slow: "var(--transition-duration-slow)",
      },
      transitionTimingFunction: {
        standard: "cubic-bezier(0.2, 0, 0, 1)",
        in: "cubic-bezier(0.4, 0, 1, 1)",
        out: "cubic-bezier(0, 0, 0.2, 1)",
      },
    },
  },

  plugins: [],
};
