"use client";

import { chakra } from "@chakra-ui/react";

/** A styled native <select>: keeps the platform picker, which works best on phones. */
export const NativeSelect = chakra("select", {
  base: {
    h: "8",
    px: "2",
    rounded: "md",
    fontSize: "sm",
    bg: "rink.surface2",
    color: "rink.text",
    borderWidth: "1px",
    borderColor: "rink.border",
  },
});
