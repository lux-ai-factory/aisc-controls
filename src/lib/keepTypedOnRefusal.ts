import { startTransition, type FormEvent } from "react";

// A form given to `action` is reset by React once its action returns, also when the action refused the
// save with {error}: the reason showed above an empty form (or the last saved answers), and what was typed
// was lost. The form keeps `action={formAction}`, so it still posts to the server action without
// JavaScript (or before the page's script runs), and adds this as onSubmit: it prevents React's own
// submit, which skips a default-prevented event, and sends the action itself, so the form keeps its
// fields. The button pressed (its name and value, for example intent=close) is sent as a native submit
// would send it.
export function keepTypedOnRefusal(formAction: (data: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const data = new FormData(event.currentTarget, submitter);
    startTransition(() => formAction(data));
  };
}
