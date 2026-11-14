import { startTransition, type FormEvent } from "react";

// A form given to `action` is reset by React once its action returns, also when the action refused the
// save with {error}: the reason showed above an empty form (or the last saved answers), and what was typed
// was lost. Sent from onSubmit instead, the form keeps its fields; the button pressed (its name and value,
// for example intent=close) is sent as a native submit would send it.
export function keepTypedOnRefusal(formAction: (data: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const data = new FormData(event.currentTarget, submitter);
    startTransition(() => formAction(data));
  };
}
