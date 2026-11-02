// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import * as React from "react";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { DateField } from "@/components/ui/date-field";

afterEach(cleanup);

// The drop-in for <input type="date">: dd/mm/yy on screen, ISO underneath.

function textbox(): HTMLInputElement {
  return screen.getByRole("textbox") as HTMLInputElement;
}

describe("DateField", () => {
  it("shows an ISO value as dd/mm/yy and the dd/mm/yy placeholder when empty", () => {
    const { rerender } = render(<DateField value="2026-11-02" onChange={() => {}} />);
    expect(textbox().value).toBe("02/11/26");
    rerender(<DateField value="" onChange={() => {}} />);
    expect(textbox().value).toBe("");
    expect(textbox().placeholder).toBe("dd/mm/yy");
  });

  it("emits ISO as soon as a full valid date is typed, and '' when cleared", () => {
    const onChange = vi.fn();
    function Controlled() {
      const [v, setV] = React.useState("");
      return <DateField value={v} onChange={(iso) => { setV(iso); onChange(iso); }} />;
    }
    render(<Controlled />);
    const el = textbox();
    fireEvent.focus(el);
    fireEvent.change(el, { target: { value: "02/11/2" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(el, { target: { value: "02/11/26" } });
    expect(onChange).toHaveBeenLastCalledWith("2026-11-02");
    fireEvent.change(el, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("flags impossible or unreadable dates and blocks form submission", () => {
    const onChange = vi.fn();
    render(<DateField value="" onChange={onChange} />);
    const el = textbox();
    fireEvent.focus(el);
    fireEvent.change(el, { target: { value: "31/02/26" } });
    fireEvent.blur(el);
    expect(onChange).not.toHaveBeenCalled();
    expect(el.getAttribute("aria-invalid")).toBe("true");
    expect(el.validity.customError).toBe(true);
    expect(el.value).toBe("31/02/26"); // left for the person to fix

    fireEvent.focus(el);
    fireEvent.change(el, { target: { value: "29/02/24" } });
    expect(onChange).toHaveBeenLastCalledWith("2024-02-29");
    fireEvent.blur(el);
    expect(el.getAttribute("aria-invalid")).toBeNull();
    expect(el.validity.customError).toBe(false);
  });

  it("honours min and max like the native input: the value is set, the field is invalid", () => {
    const onChange = vi.fn();
    render(<DateField value="" min="2026-11-01" max="2026-11-30" onChange={onChange} />);
    const el = textbox();
    fireEvent.focus(el);
    fireEvent.change(el, { target: { value: "31/10/26" } });
    expect(onChange).toHaveBeenLastCalledWith("2026-10-31");
    expect(el.validity.customError).toBe(true);
    expect(el.title).toMatch(/on or after 01\/11\/26/);
    fireEvent.change(el, { target: { value: "15/11/26" } });
    expect(el.validity.customError).toBe(false);
  });

  it("the native picker sits over the calendar icon and feeds back ISO", () => {
    const onChange = vi.fn();
    render(<DateField value="2026-11-02" min="2026-01-01" onChange={onChange} />);
    const native = screen.getByLabelText("Open calendar") as HTMLInputElement;
    expect(native.type).toBe("date");
    expect(native.value).toBe("2026-11-02");
    expect(native.min).toBe("2026-01-01");
    fireEvent.change(native, { target: { value: "2026-12-25" } });
    expect(onChange).toHaveBeenLastCalledWith("2026-12-25");
  });

  it("works uncontrolled, carrying ISO for FormData through a hidden input", () => {
    const { container } = render(
      <form>
        <DateField name="due" defaultValue="2026-11-02" required />
      </form>,
    );
    const hidden = container.querySelector('input[type="hidden"][name="due"]') as HTMLInputElement;
    expect(hidden.value).toBe("2026-11-02");
    expect(textbox().required).toBe(true);
    const el = textbox();
    fireEvent.focus(el);
    fireEvent.change(el, { target: { value: "05/01/27" } });
    fireEvent.blur(el);
    expect(hidden.value).toBe("2027-01-05");
    expect(el.value).toBe("05/01/27");
    // Only the hidden input is named: FormData sees one ISO value, never the typed text.
    expect(new FormData(container.querySelector("form")!).getAll("due")).toEqual(["2027-01-05"]);
  });

  it("keeps width classes on the wrapper so layouts are unchanged, and disables the picker when disabled", () => {
    const { container } = render(<DateField value="" className="w-40 h-10 border max-md:w-full" disabled onChange={() => {}} />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("w-40");
    expect(wrapper.className).toContain("max-md:w-full");
    expect(textbox().className).toContain("h-10");
    expect(textbox().className).not.toContain("w-40");
    expect(textbox().disabled).toBe(true);
    expect(screen.queryByLabelText("Open calendar")).toBeNull();
  });
});
