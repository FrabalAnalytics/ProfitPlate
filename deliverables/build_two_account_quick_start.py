"""Short replacement for the original handbook. Only generates documents and test files."""
from pathlib import Path
from decimal import Decimal
import shutil, zipfile, csv, io

ROOT=Path(__file__).resolve().parents[1]
# Reuse the existing handbook's formatting helpers without running its long content generator.
source=(ROOT/'deliverables/build_owner_guide.py').read_text(encoding='utf-8')
exec(source.split('doc.core_properties.title =',1)[0].replace('Guide v1.0','Guide v2.2'),globals())
doc.core_properties.title='ProfitPlate: Two-Account Quick Start'
doc.core_properties.author='ProfitPlate'
doc.core_properties.subject='What ProfitPlate does and one verified test using two email accounts'
OUT=ROOT/'web/public/guides'
new_file=OUT/'ProfitPlate_Two_Account_Quick_Start_v2_2.docx'
sale='external_id,menu_code,quantity,location,net_sales\nEASY-POS-001,EASY-MEAL,3,KITCHEN,1500\n'

p('PROFITPLATE',True)
doc.add_heading('What it does.\nHow to try it.',0)
p('Your two-email quick start • Version 2.2 • 28 October 2026',True)
p('Use this guide instead of the earlier long handbook. You need only your existing Owner email and one second email. No real staff accounts are required for this exercise.')
sub('The product in one sentence')
note('ProfitPlate helps restaurant owners control stock, track recipe costs and understand margins from recorded daily operations.')
p('A product is the whole application. A feature is something it does. A benefit is why that feature matters to the restaurant.')
table(['Business question','Feature','Benefit'],[
 ('What did we buy and receive?','Purchase orders and receiving','See deliveries and outstanding quantities.'),
 ('Where is our stock?','Main Store, Kitchen and Bar balances/transfers','Track stock as it changes location.'),
 ('What should a sale consume?','Recipes and approved sales import','Apply consistent ingredient quantities.'),
 ('Where are the losses?','Waste records and stock counts','Investigate recorded losses and discrepancies.'),
 ('What do costs mean for margin?','Cost and margin reports','Review recipe economics and approved financial figures.')])
sub('Your first goal')
p('Buy 20 kg of test rice, move 10 kg to Kitchen, sell 3 meals and check: Main Store 10 kg; Kitchen 4 kg; theoretical cost of sales NGN 600; theoretical gross profit NGN 900; theoretical gross margin 60%.')
note('This is a working early product for controlled testing. Actual accounting COGS currently requires supported Finance input and approval. Theoretical margin alone is not verified accounting profit.')
p('For now, ignore production, Bar exercises, advanced counts and platform administration. Complete this one small test first.')

chapter(1,'Use your two emails','A = your existing Owner email; B = your second email')
table(['Label used below','Email to use','Testing duties'],[
 ('ACCOUNT A','Your existing Owner email','Keep Owner. Add Procurement duty and an Operations Manager appointment for this test.'),
 ('ACCOUNT B','Your second verified email','Join as Storekeeper / Inventory Manager. Add an Operations Manager appointment.')])
p('Keep your current two-account testing appointments. A uses its explicit Procurement duty to raise orders and its Operations duty for combined stock tasks. B uses Storekeeper duties to receive goods and Operations duties to approve orders and sales created by account A. Accepting a delivery against an approved order needs no second receipt approval. Restricted staff roles are tested separately later.')
sub('First: invite your second email')
steps(['Sign in as A and open Team and access. On a phone, tap Menu first.',
 'Under Invite a team member, enter your second email in Invited email.',
 'Choose Storekeeper / Inventory Manager under Working role. Click Generate invitation code. Copy the full code privately.',
 'Open a separate normal browser profile for B, or sign out of A before switching. Sign up/verify B if needed, then sign in as B.',
 'B should JOIN your restaurant, not create a new restaurant. Open the app address followed by /join, or choose Enter your team access code on the setup screen.',
 'Check the Join page shows B’s email. Paste the code into Business access code. Click Join business.'])
sub('Second: give both logins the testing approval duty')
steps(['Return to A → Team and access → Manager appointments.',
 'Select B’s email under Active team member. Choose Operations Manager. Click Appoint manager.',
 'Repeat for A’s own email. A stays the restaurant Owner; the appointment adds a testing duty.',
 'Refresh each account’s workspace. Seeing an Operations Manager label is expected after these appointments.'])
sub('Third: explicitly assign the purchasing duty to A')
steps(['As A, open Team and access > Additional operational duties.',
 'Under Duty holder select Account A Owner email. Choose Procurement Officer under Additional duty.',
 'Enter Reason / reference = Owner acting as Procurement for testing. Click Assign additional duty.',
 'Refresh Purchasing. A should now see New purchase order. B can review, approve and receive; B does not get order-creation authority merely from being Operations Manager.'])
check('Both accounts have their testing Operations appointments, and A also has an explicit Procurement duty. No extra email is needed.')
note('Check the signed-in email whenever you switch. Two devices using the same login are still one account. In this controlled test you can simulate both; live independent approvals should be performed by the designated people.')

chapter(2,'Check the three locations and today’s period','ACCOUNT A','Inventory → Operating controls')
steps(['Find Three operating areas. If Main Store, Kitchen and Bar are already mapped correctly, leave them alone.',
 'If setup is incomplete, click Set up the three areas. If a manual choice is needed, choose three different existing locations and click Save operating areas.',
 'Find Inventory periods. Confirm today is inside an Open period. If yes, do not create another overlapping period.',
 'Only if today has no configured period: enter Start date = today and End date = the end of the current month, provided that range does not overlap an existing period. Click Create open period.',
 'If the period exists but is Closed, use Reopen period and enter a clear test reason.'])
note('Use today’s business date throughout this first exercise. Do not backdate it to make the accounting report work immediately. Transfer confirmation uses today’s date, so a same-day exercise is easier to understand.')
sub('Before entering any new items')
bullets(['Keep your existing catalogue. The test uses new EASY codes so it does not replace the imported items.',
 'If you already see EASY-RICE, EASY-SUPPLIER or EASY-MEAL from a prior run, stop and inspect them. Do not repeat a stock transaction just to restart.',
 'If there are unrelated posted sales today, the whole-business report will also include them. The exact report totals in this guide apply when this is the only sale in the selected period.'])
p('Today’s test date: ____________________',True)
p('Your working app address: ____________________',True)
check('All three areas are configured and today is within an Open period.')

chapter(3,'Add only one item, one supplier and one pack','ACCOUNT A')
sub('A. Add the stock item')
p('Open Inventory → Items. Scroll to Add inventory item. Enter:')
table(['Field','Value'],[('Item name','Easy Test Rice'),('SKU','EASY-RICE'),('Category','Raw material'),('Base unit','kg')])
p('Click Add inventory item. You have defined the item; you have not yet put any rice into stock.')
sub('B. Add the supplier')
p('Open Master data → Vendors. Under Add vendor enter:')
table(['Field','Value'],[('Vendor code','EASY-SUPPLIER'),('Vendor name','Easy Test Supplier'),('Status','Active')])
p('Leave optional contact details blank. Click Save vendor.')
sub('C. Explain the supplier’s bag size')
p('Open Master data → Supplier items. Under Link a supplier item enter:')
table(['Field','Value'],[('Vendor','Easy Test Supplier'),('Inventory item','Easy Test Rice (kg)'),('Purchase unit / pack','bag'),('Base units per purchase unit','10'),('Quoted price per purchase unit (NGN)','1000'),('Pack specification / evidence','Fictional test: one bag = 10 kg'),('Status','Active')])
p('Click Save supplier item. One bag contains 10 kg. The quote is NGN 1000 per bag, which equals NGN 100 per kg when received at that price.')
check('The item, supplier and pack are saved. Stock is still zero. A quote does not create stock or an inventory average.')

chapter(4,'Buy the rice and record its delivery','Follow the A/B handoffs below','Purchasing')
sub('A acts as Procurement to create the order; B approves it')
steps(['As A, open Purchasing. Click Easy Test Supplier under New purchase order.',
 'Enter Reason / reference = EASY-ORDER. Select Easy Test Rice as Item 1. Enter Purchase quantity 1 = 2 and Price per purchase unit 1 (NGN) = 1000.',
 'Click Save purchase order draft, then Submit order for approval on the EASY-ORDER card. Total order value should be NGN 2000.',
 'Switch to B → Purchasing. Find EASY-ORDER and click Approve purchase order. Stock is still zero because the goods have not been received.'])
sub('B accepts the delivery and stock updates immediately')
steps(['Still as B, expand Record accepted delivery on EASY-ORDER.',
 'Keep Receiving date = today. Choose Main Store as Receiving location. Enter Reason / reference = EASY-DELIVERY.',
 'Select Easy Test Rice (bag). Enter Accepted purchase quantity 1 = 2 and leave Rejected purchase quantity 1 = 0.',
 'Review the accepted quantities and click Accept delivery and update stock. Stock posts immediately against the approved purchase order.',
 'Open Inventory → Stock on hand. Confirm Main Store has 20 kg rice at an average cost of NGN 100/kg.'])
note('A raises the purchase order as Procurement; B approves it as Operations, then accepts the goods as Storekeeper. The approved purchase order authorizes the receipt, so A does not approve the delivery again. Other controlled transactions retain independent approval.')
table(['Step','Account','Result'],[('Raise purchase order','A as Procurement','Submitted order'),('Approve purchase order','B as Operations','Purchase authorized'),('Accept delivery','B as Storekeeper','Stock updates immediately')])
note('If EASY-DELIVERY already exists as a draft or submitted record, do not enter it again. As B, open Purchasing > Previously saved deliveries > Review recorded delivery, review its quantities and click Accept delivery and update stock on the existing document.')
check('Main Store holds 20 kg rice. Store acceptance of the delivery, rather than the order or quote alone, established the stock and cost.')

chapter(5,'Move rice to Kitchen and define one meal','ACCOUNT A creates; ACCOUNT B approves the transfer')
sub('A. Send 10 kg to Kitchen')
steps(['As A, open Inventory → Documents & approvals → transfer.',
 'Keep Event date = today. Enter reason EASY-TO-KITCHEN. Set Source location Main Store and Destination location Kitchen.',
 'Select Easy Test Rice and enter Quantity 1 = 10. Click Save draft, then Submit for approval.',
 'Switch to B. Find EASY-TO-KITCHEN and click Approve and post. Stock is now dispatched/in transit.',
 'Switch back to A. Find the same transfer → Confirm received quantities. Enter a receipt reason, select Easy Test Rice and Quantity 1 = 10, then click Confirm receipt.',
 'Check Stock on hand: Main Store 10 kg and Kitchen 10 kg. For this combined-duty test, A handles the dispatch entry and Kitchen acknowledgement; B supplied independent transaction approval.'])
sub('B. Define what one meal uses')
p('As A, open Master data → Final recipes → Create a recipe. Enter:')
table(['Field','Value'],[('Recipe name','Easy Rice Meal'),('Recipe / menu code','EASY-RECIPE'),('Semi-finished output SKU','Leave blank'),('Standard output quantity','1'),('Item 1','Easy Test Rice (kg)'),('Quantity 1','2')])
p('Click Save recipe. One meal uses 2 kg. This exaggerated quantity makes the fictional test arithmetic simple.')
sub('C. Map its sales code')
p('Open Master data → Menu mapping → Add menu mapping. Enter:')
table(['Field','Value'],[('POS / menu code','EASY-MEAL'),('Menu item name','Easy Rice Meal'),('Sales category','Food'),('Final recipe','EASY-RECIPE · Easy Rice Meal'),('Usual preparation location','Kitchen'),('Status','Active')])
p('Click Save menu mapping. The sales file will use EASY-MEAL, not EASY-RECIPE.')
check('Stock is 10 kg Main Store + 10 kg Kitchen. One saved meal requires 2 kg of rice.')

chapter(6,'Import one sale and understand the result','A imports; B approves','Inventory → Sales import')
p('Use the included ProfitPlate_Easy_Sales.csv. It contains one row: 3 meals, Kitchen, total net revenue NGN 1500.')
steps(['As A, open Sales import and select ProfitPlate_Easy_Sales.csv under Sales CSV file. Wait for 1 sales line ready for validation.',
 'Enter Source system = EASY-POS. Keep Sales business date = today. Enter Import reference / reason = EASY-SALES.',
 'Click Validate and save sales draft. Review the rice deduction, then click Submit for approval.',
 'Switch to B → Inventory → Documents & approvals. Find EASY-SALES and click Approve and post.',
 'Open Reports. Choose Daily, today’s reference date and Whole business. Click View report. If you completed the exercise across dates, select a custom range covering the exercise.'])
table(['You should see','Why'],[('Kitchen rice = 4 kg','10 kg received − (3 meals × 2 kg).'),('Main Store rice = 10 kg','These sales target Kitchen, not Main Store.'),('Net sales = NGN 1500','This is the whole sales line’s revenue, not unit price.'),('Theoretical COGS = NGN 600','3 meals × 2 kg × NGN 100/kg.'),('Theoretical gross profit = NGN 900','1500 revenue − 600 theoretical COGS.'),('Theoretical gross margin = 60%','900 / 1500 × 100.'),('Theoretical food cost = 40%','600 / 1500 × 100.')])
note('Actual COGS and actual gross margin may say Unavailable. That is expected: this sale proves the recipe-based calculation, not complete accounting consumption. Do not enter invented Finance figures to make the real restaurant look profitable.')
check('You can explain the stock movement and the NGN 600 / NGN 900 / 60% theoretical result. Stop here for your first session.')

chapter(7,'What to do after the first exercise')
sub('Your simple product explanation')
note('“ProfitPlate records what we buy, where our stock goes and what our recipes should consume. It helps us investigate losses and review food costs and margins.”')
sub('Optional: the completed-day Finance test')
p('Wait until the selected reporting period has ended—tomorrow if you finished today. Choose the completed test date/range and Whole business. There must be no pending stock records for that period. For a purely fictional test, A can submit a reconciliation with 1 source line, net sales 1500, COGS 700 and food cost 650, with a clearly labelled test evidence reference. B reviews and approves it. Expected gross profit: 800; gross margin: 53.3333%; food cost: 43.3333%. These entered test costs demonstrate the approval/formula workflow, not independently calculated accounting COGS.')
sub('What two combined-role accounts do not prove')
p('Both accounts currently have broad Operations permissions, but only A has Procurement authority. This walkthrough tests transaction handoffs; it does not fully test restricted Kitchen or Bar access. Later, A can remove B’s manager appointment and change B’s working role for one focused permission test at a time, then restore the testing setup. No extra email is needed for that.')
sub('If you get stuck')
table(['Problem','Check first'],[('No receiving action for A','Use B: A created the purchase order.'),('Existing receipt still pending','As B, review the saved delivery and click Accept delivery and update stock.'),('A cannot approve its own sale','Use B.'),('Posting date/period error','Today must be inside an Open period.'),('Wrong report totals','Check the period, sale status and other posted sales in that restaurant.'),('Actual figures unavailable','Use theoretical figures now; Finance needs completed dates and an approved supported reconciliation.'),('A wrong record already posted','Record its reference and ask for help; do not delete history or create offsetting waste.')])
sub('Your result')
for label in ['Second email joined the same restaurant','Both testing appointments set','Rice received: 20 kg','Main Store 10 kg / Kitchen 4 kg after sale','Theoretical COGS 600 / GP 900 / margin 60%']:
 p('[ ] '+label)
p('If one step fails, stop there. Record the account label, screen, button and exact message. We should solve that step before moving to production, counts or more advanced reports.')

assert Decimal('3')*Decimal('2')*Decimal('100')==Decimal('600')
assert (Decimal('1500')-Decimal('600'))/Decimal('1500')*100==Decimal('60')
doc.save(new_file)
csv_file=OUT/'ProfitPlate_Easy_Sales.csv';csv_file.write_text(sale,encoding='utf-8-sig',newline='')
pack=OUT/'ProfitPlate_Two_Account_Starter_Pack_v2_2.zip'
with zipfile.ZipFile(pack,'w',compression=zipfile.ZIP_DEFLATED) as z:
 z.write(new_file,new_file.name);z.write(csv_file,csv_file.name)
archive=ROOT/'deliverables/archive';archive.mkdir(exist_ok=True)
canonical=OUT/'ProfitPlate_Kitchen_Owner_Beginner_Guide.docx'
oldpack=OUT/'ProfitPlate_Owner_Guide_Starter_Pack.zip'
if canonical.exists() and not (archive/'ProfitPlate_Owner_Guide_v1.docx').exists():shutil.copy2(canonical,archive/'ProfitPlate_Owner_Guide_v1.docx')
if oldpack.exists() and not (archive/'ProfitPlate_Owner_Starter_Pack_v1.zip').exists():shutil.copy2(oldpack,archive/'ProfitPlate_Owner_Starter_Pack_v1.zip')
shutil.copy2(new_file,canonical);shutil.copy2(pack,oldpack)
# Existing v2 download links should also serve the corrected purchasing instructions.
shutil.copy2(new_file,OUT/'ProfitPlate_Two_Account_Quick_Start_v2.docx')
shutil.copy2(pack,OUT/'ProfitPlate_Two_Account_Starter_Pack_v2.zip')
shutil.copy2(new_file,OUT/'ProfitPlate_Two_Account_Quick_Start_v2_1.docx')
shutil.copy2(pack,OUT/'ProfitPlate_Two_Account_Starter_Pack_v2_1.zip')
with zipfile.ZipFile(new_file) as z:assert z.testzip() is None
with zipfile.ZipFile(pack) as z:assert z.testzip() is None and len(z.namelist())==2
reopened=Document(new_file)
assert len([x for x in reopened.paragraphs if x.style.name=='Heading 1'])==7
assert len(list(csv.DictReader(io.StringIO(sale))))==1
print('Created:',new_file)
print('Created:',pack)
print('Original v1 archived privately; original public download filenames now serve the two-account version.')
print('Text words:',sum(len(p.text.split()) for p in reopened.paragraphs)+sum(len(c.text.split()) for t in reopened.tables for r in t.rows for c in r.cells))
