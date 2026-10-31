export const operationNotice: Record<string, string> = {
  sales_posted:
    "Sales approved and posted. Sales revenue and the corresponding inventory deductions were recorded together.",
  transfer_dispatched:
    "Transfer approved and dispatched. Stock is reserved in Store until the receiving department accepts it.",
  document_posted: "Document approved and posted. Stock balances have updated.",
  receive_transfer:
    "Accepted quantities posted. Both stock balances have updated; other quantities remain pending.",
  reject_transfer:
    "Rejection recorded. Rejected quantities await return to Store.",
  return_transfer:
    "Return confirmed. Returned quantities are available in Store again.",
  submit_document: "Submitted for independent approval. Stock has not changed.",
  create_document:
    "Draft saved. Stock has not changed. Submit it for approval.",
  create_requisition:
    "Request draft saved. Submit it for manager approval. Stock has not changed.",
  submit_requisition:
    "Request submitted for independent manager approval. Stock has not changed.",
  approve_requisition:
    "Request approved. Store can now prepare and dispatch available quantities. Stock has not changed.",
  fulfil_requisition:
    "Stock dispatched and reserved in Store. The receiving department can now accept or reject each item below.",
  reject_requisition: "Request rejected. Stock has not changed.",
  close_requisition:
    "Remaining demand closed. Existing deliveries still require acceptance or confirmed return.",
};
