import type { Address } from "viem";

type AddressRowProps = {
  name: string;
  address: Address | null;
};

export default function AddressRow({
  name,
  address,
}: AddressRowProps) {
  return (
    <div className="address-row">
      <span>{name}</span>
      <code>{address ?? "Loading..."}</code>
    </div>
  );
}