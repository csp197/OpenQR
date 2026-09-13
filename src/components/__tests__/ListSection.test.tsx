import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import ListSection from "../ListSection";

describe("ListSection", () => {
  it("renders the block variant with its title, description, and empty state", () => {
    render(
      <ListSection variant="block" items={[]} onChange={vi.fn()} otherListItems={[]} otherListName="Only allow these sites" />,
    );
    expect(screen.getByRole("heading", { name: "Blocked sites" })).toBeInTheDocument();
    expect(screen.getByText("These sites will never open.")).toBeInTheDocument();
    expect(screen.getByText("No blocked sites yet.")).toBeInTheDocument();
    expect(screen.queryByText("Off")).not.toBeInTheDocument();
  });

  it("renders the allow variant with an 'Off' badge when empty", () => {
    render(
      <ListSection variant="allow" items={[]} onChange={vi.fn()} otherListItems={[]} otherListName="Blocked sites" />,
    );
    expect(screen.getByRole("heading", { name: "Only allow these sites" })).toBeInTheDocument();
    expect(screen.getByText("No sites yet — all sites can open.")).toBeInTheDocument();
    expect(screen.getByText("Off")).toBeInTheDocument();
  });

  it("shows an 'On' badge and pluralized note once entries exist", () => {
    render(
      <ListSection
        variant="allow"
        items={["a.com", "b.com"]}
        onChange={vi.fn()}
        otherListItems={[]}
        otherListName="Blocked sites"
      />,
    );
    expect(screen.getByText("On")).toBeInTheDocument();
    expect(screen.getByText("Only 2 sites can open. Everything else is blocked.")).toBeInTheDocument();
  });

  it("disables Add while the input is empty and enables it once text is entered", () => {
    render(
      <ListSection variant="block" items={[]} onChange={vi.fn()} otherListItems={[]} otherListName="Only allow these sites" />,
    );
    const button = screen.getByRole("button", { name: "Add" });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Add a blocked site"), { target: { value: "example.com" } });
    expect(button).not.toBeDisabled();
  });

  it("normalizes and adds a domain on Enter, calling onChange with newest first", () => {
    const onChange = vi.fn();
    render(
      <ListSection
        variant="block"
        items={["old.com"]}
        onChange={onChange}
        otherListItems={[]}
        otherListName="Only allow these sites"
      />,
    );
    const input = screen.getByLabelText("Add a blocked site");
    fireEvent.change(input, { target: { value: "HTTPS://Example.com/path" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith(["example.com", "old.com"]);
  });

  it("shows an alert for an invalid domain", () => {
    render(
      <ListSection variant="block" items={[]} onChange={vi.fn()} otherListItems={[]} otherListName="Only allow these sites" />,
    );
    const input = screen.getByLabelText("Add a blocked site");
    fireEvent.change(input, { target: { value: "not a domain" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByRole("alert")).toHaveTextContent("Enter a site like example.com");
  });

  it("rejects a duplicate already in this list", () => {
    const onChange = vi.fn();
    render(
      <ListSection
        variant="block"
        items={["example.com"]}
        onChange={onChange}
        otherListItems={[]}
        otherListName="Only allow these sites"
      />,
    );
    const input = screen.getByLabelText("Add a blocked site");
    fireEvent.change(input, { target: { value: "example.com" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("example.com is already in Blocked sites.");
  });

  it("rejects a duplicate already in the other list, naming it", () => {
    const onChange = vi.fn();
    render(
      <ListSection
        variant="allow"
        items={[]}
        onChange={onChange}
        otherListItems={["example.com"]}
        otherListName="Blocked sites"
      />,
    );
    const input = screen.getByLabelText("Add an allowed site");
    fireEvent.change(input, { target: { value: "example.com" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("example.com is already in Blocked sites.");
  });

  it("clears the error as soon as the user types again", () => {
    render(
      <ListSection variant="block" items={[]} onChange={vi.fn()} otherListItems={[]} otherListName="Only allow these sites" />,
    );
    const input = screen.getByLabelText("Add a blocked site");
    fireEvent.change(input, { target: { value: "bad" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("alert")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "bad2" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("removes an entry via its accessible remove button", () => {
    const onChange = vi.fn();
    render(
      <ListSection
        variant="block"
        items={["example.com"]}
        onChange={onChange}
        otherListItems={[]}
        otherListName="Only allow these sites"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove example.com" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
