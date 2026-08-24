import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Password field with a show/hide toggle.
 *
 * Typing a password blind is the main reason people mistype one and think
 * their account is broken, so the reveal is worth having on sign-in as well as
 * registration.
 *
 * The toggle is a real <button type="button"> so it never submits the form,
 * and it is skipped in tab order — reaching it by Tab on the way to "Sign in"
 * is a nuisance, and it stays reachable by pointer and by shift-tabbing back.
 */
export const PasswordInput = React.forwardRef(function PasswordInput(
  { className, buttonClassName, ...props },
  ref,
) {
  const [visible, setVisible] = React.useState(false);

  return (
    <div className="relative">
      <Input
        ref={ref}
        type={visible ? "text" : "password"}
        // Room for the toggle so a long password never runs under it.
        className={cn("pr-10", className)}
        {...props}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        title={visible ? "Hide password" : "Show password"}
        className={cn(
          "absolute top-1/2 right-1 grid size-8 -translate-y-1/2 place-items-center rounded-md",
          "text-muted-foreground transition-colors hover:text-foreground",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          buttonClassName,
        )}
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
});
