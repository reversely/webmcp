# Favor vendor survey (CA)

Rebuilt from products-ca.csv (1164 rows), sellers-ca.csv (477 sellers), and card-categories-ca.csv by summarize.mts. Each row of queries.csv was one Global Catalog `search_catalog` call: 50 results, in stock, shipping to the run's address, shops located in the run's country, a price ceiling where the row has one. Nothing was hand-picked.

## Search types

| Type | Queries | Product rows | Distinct sellers | Rows with personalization words | Rows with dietary words |
| --- | --- | --- | --- | --- | --- |
| category | 7 | 350 | 151 | 45 | 4 |
| personalization | 4 | 200 | 115 | 192 | 6 |
| dietary | 3 | 150 | 95 | 3 | 105 |
| occasion | 4 | 199 | 71 | 97 | 0 |
| bulk | 2 | 100 | 51 | 17 | 3 |
| price | 2 | 65 | 29 | 5 | 0 |
| sentence | 2 | 100 | 58 | 5 | 1 |

## Queries, with the sellers each one returned

| Type | Query | Price ceiling | Rows | Sellers | Top sellers (products each) |
| --- | --- | --- | --- | --- | --- |
| category | party favors |  | 50 | 14 | Party Expert (www.party-expert.com) 23; Pretty Day (www.prettyday.com) 8; Party Stuff (www.partystuff.ca) 4; CONFETTIMYPARTY (www.confettimyparty.com) 3; Lemon And Lavender Toronto (shop.lemonlavender.com) 2 |
| category | cookie favors |  | 50 | 6 | Cookies By Design - Canada (cookiesbydesign.ca) 43; Sweet Flour Bake Shop (www.sweetflour.ca) 3; Cookista (cookista.ca) 1; Veehacart (veehacart.ca) 1; Blue Sheep Bake Shop (bluesheepbakeshop.com) 1 |
| category | dessert box gift |  | 50 | 34 | Sweet Flour Bake Shop (www.sweetflour.ca) 7; HAZELTON's (www.hazeltons.ca) 5; Vancouver Blooms (vancouverblooms.ca) 3; YORKVILLE's (yorkvilles.ca) 2; Churchill's Fine Gourmet Gifts (churchillsgourmetgifts.com) 2 |
| category | candle favors |  | 50 | 27 | Flowerhint (www.flowerhint.com) 9; Bumbleberry Decor Ltd. (bumbleberrydecorltd.com) 7; Heavenpartyflowers (heavenpartyflowers.com) 3; Lulu Island Honey (luluislandfavours.ca) 2; Artlavka  (artlavka-2.myshopify.com) 2 |
| category | sticker sheet |  | 50 | 9 | Hubman and Chubgirl (hubmanchubgirl.store) 41; TheCoffeeMonsterzCo (thecoffeemonsterzco.com) 2; Sira Print Inc. 1; Sugarbones (sugarbones.net) 1; Stickerbeat.com (stickerbeat.com) 1 |
| category | coasters gift |  | 50 | 31 | Kaleidopamine Studio (kaleidopaminestudio.com) 14; The Modern Shop (themodernshop.com) 5; Maison Lipari (www.maisonlipari.ca) 2; Boutique Marie Dumas (mariedumas.com) 2; Lynn & Liana Designs (lynnliana.com) 1 |
| category | tote bag gift |  | 50 | 35 | Present Agent (store.presentagent.vip) 5; Ibiza One Stop (ibizaonestop.com) 4; Bajoue (bajoue.ca) 4; Something Personalized (somethingpersonalized.ca) 2; Indigo (www.indigo.ca) 2 |
| personalization | personalized party favors |  | 50 | 24 | Halo B Designs  (www.halobdesigns.com) 11; Custom Favorz by Sharon (customfavorzbysharon.myshopify.com) 10; PlumPolkaDot (www.plumpolkadot.com) 6; The Sugar Cube (www.sugarcubeyyc.com) 3; Readymade Play Canada  (readymadeplaycanada.com) 1 |
| personalization | custom cookies with names |  | 50 | 32 | Sweet Flour Bake Shop (www.sweetflour.ca) 4; Sullivan & Bleeker Baking Co. (sullivanbleeker.com) 4; 23sweets (23sweets.com) 3; Cookies By Design - Canada (cookiesbydesign.ca) 3; Sweet Yummy (sweetyummycookies.com) 2 |
| personalization | engraved coaster |  | 50 | 34 | Inkpot 6; Elite Embellishments (eliteembellishments.ca) 4; Memories Made Custom (memoriesmade.ca) 3; Wild Touch Engraving (www.wildtouchengraving.com) 3; FnC workshop (fncgiftstore.ca) 2 |
| personalization | monogrammed tote bag |  | 50 | 25 | Ibiza One Stop (ibizaonestop.com) 9; LXRY + (lxrywear.com) 7; Poshbag Boutique 3; Mine & Yours (www.mineandyours.com) 3; Barry's Jewellers (barrysjewellers.com) 3 |
| dietary | vegan cookie favors |  | 50 | 39 | Bunner's Bakeshop (bunners.ca) 4; Whisked Away (www.whiskedaway.ca) 3; Crave Cupcakes (www.cravecupcakes.ca) 2; Sweet Flour Bake Shop (www.sweetflour.ca) 2; Marsha Sophia (www.marshasophia.ca) 2 |
| dietary | gluten free cookies gift |  | 50 | 32 | Sweets from the Earth (shop.sweetsfromtheearth.com) 6; Whisked Gluten-Free Bakery (whiskedglutenfree.com) 4; Crave Cupcakes (www.cravecupcakes.ca) 3; Lobo Worldwide Inc. (www.loboworldwide.com) 3; Aura Natural Market (www.auramarket.ca) 2 |
| dietary | nut free chocolate gift box |  | 50 | 37 | Present Agent (store.presentagent.vip) 5; HAZELTON's (www.hazeltons.ca) 3; ANNE of Green Gables Chocolates (annechocolates.com) 2; Maker House Co. (makerhouse.com) 2; The Little Market Box (www.thelittlemarketbox.com) 2 |
| occasion | wedding favors for guests |  | 49 | 14 | Flowerhint (www.flowerhint.com) 25; PlumPolkaDot (www.plumpolkadot.com) 7; Bumbleberry Decor Ltd. (bumbleberrydecorltd.com) 3; Baby Shower Chocolate (babyshowerchocolate.com) 2; MAIOUMA INC. (maiouma.com) 2 |
| occasion | baby shower favors |  | 50 | 17 | PlumPolkaDot (www.plumpolkadot.com) 26; Bumbleberry Decor Ltd. (bumbleberrydecorltd.com) 7; Baby Joy Canada (babyjoy.ca) 2; Cookies By Design - Canada (cookiesbydesign.ca) 2; the Cubit Lab (thecubitlab.com) 1 |
| occasion | kids party favor bags |  | 50 | 16 | Party Expert (www.party-expert.com) 25; Pretty Day (www.prettyday.com) 5; Lemon And Lavender Toronto (shop.lemonlavender.com) 2; The Cross Living (www.thecrossliving.com) 2; Buchan's Kerrisdale Stationery (www.buchanst.com) 2 |
| occasion | corporate event gifts for attendees |  | 50 | 30 | Luxify Gifts (luxifygifts.com) 5; Gifty (gifty.media) 4; Wrap Artist Baskets (www.wrapartistbaskets.ca) 3; Fancy Collective (fancycollective.ca) 3; MY BASKETS (www.mybaskets.ca) 3 |
| bulk | party favors bulk 50 |  | 50 | 20 | Flowerhint (www.flowerhint.com) 8; Bazaar & Novelty (bazaarnovelty.ca) 7; Party Stuff (www.partystuff.ca) 6; Party Expert (www.party-expert.com) 5; Party Warehouse 5 |
| bulk | cookies bulk order 100 |  | 50 | 31 | Palengke Wholesale (www.palengke.ca) 5; Casepack (casepack.ca) 4; BH Food Group (bhfoodgroup.com) 4; Sweet Flour Bake Shop (www.sweetflour.ca) 3; MVR Plus (plus.mvrwholesale.com) 3 |
| price | party favors | 10 | 15 | 7 | Palico Cards & Collectibles (palicocards.ca) 6; Premium Sports Cards (www.premiumsportscards.ca) 3; MAIOUMA INC. (maiouma.com) 2; Bargain Balloons Canada (bargainballoons.ca) 1; Jack's On Queen (jacksonqueen.ca) 1 |
| price | personalized party favors | 25 | 50 | 26 | Out Of The Box CA (outoftheboxtcg.com) 7; Tabletop Giant (tabletopgiant.ca) 5; Boutique Le Chevalier (boutiquelechevalier.com) 4; MAIOUMA INC. (maiouma.com) 3; The CG Realm (www.thecgrealm.com) 3 |
| sentence | a small dessert box each guest can take home |  | 50 | 42 | nutmegspiced (nutmegspiced.ca) 3; PickEco Refills  (www.pickeco.ca) 3; Take Another Bite (takeanotherbite.com) 2; The Happy Box (thehappybox.ca) 2; Vancouver Blooms (vancouverblooms.ca) 2 |
| sentence | something for the kids at a birthday party under ten dollars |  | 50 | 16 | Party Expert (www.party-expert.com) 22; Momentko (momentko.com) 9; Party Stuff (www.partystuff.ca) 4; Neighbor Buy (www.nbbuy.ca) 2; Dollar Max Dépôt (www.dollarmaxdepot.com) 2 |

## Sellers

477 sellers; 474 answer the thirteen UCP tools; 465 carry the WebMCP loader.

| Seller | Search types | Products | With personalization words | UCP tools | Price min (cents) | Option names | Sample titles |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Sweet Flour Bake Shop (www.sweetflour.ca) | category; personalization; dietary; occasion; bulk; sentence | 21 | 7 | 13 | 450 | Add a decorated cookie (6), Select the packaging (4), Select the shape (3), Select the ribbon colour (if ribbon option selected above) (3) | Thank You Sugar Cookies | Gourmet Cookie Gift Box (24) | Gift Bag of 6 Mini Cookies |
| Party Expert (www.party-expert.com) | category; occasion; bulk; sentence | 76 | 0 | 13 | 149 |  | Happy Icons Surprise Balls, 6 Count | Spider-Man mega favor pack, 48 per package | Fairy Party Paper Bags, 8 Count |
| Cookies By Design - Canada (cookiesbydesign.ca) | category; personalization; dietary; occasion | 49 | 8 | 13 | 499 | Gourmet flavor: (1) | School Love Favor Tray | Party Cupcakes Favor Tray | Pool Party Favor Tray |
| Flowerhint (www.flowerhint.com) | category; personalization; occasion; bulk | 43 | 30 | 13 | 1757 |  | Rose Shaped Scented Candle Favors in Bulk  -  Personalized Wedding Bridal Baby Shower Birthday Gift  - Natural Soy Wax - |
| Party Stuff (www.partystuff.ca) | category; occasion; bulk; sentence | 17 | 1 | 13 | 199 |  | 48 Count Hello Kitty Party Favor Pack | Minecraft Favour Pack, 48 pieces | Favor Box - Heart, 8 Count, 4.5" |
| Veehacart (veehacart.ca) | category; personalization; dietary; bulk | 6 | 0 | 13 | 1968 | Pack size (4) | Dohful Assorted Cookies | Dohful Assorted Cookies | Dohful S'mores Chocolate Chunk Cookies |
| PlumPolkaDot (www.plumpolkadot.com) | personalization; occasion; bulk | 42 | 42 | 13 | 199 |  | Floral Party Favors, Hair Ties | Donut Party Favors, Hair Ties | Royal Blue & Silver Glitter Party Favors, Hair Ties |
| Bumbleberry Decor Ltd. (bumbleberrydecorltd.com) | category; personalization; occasion | 18 | 10 | 13 | 500 | Quantity (17), Color (8), Favor options (6), Scent (3) | Personalized Wedding Favors - Candle Box | "Oh Baby!" Teddy Bear Favors | "Oh Baby" Lion Party Favors |
| MAIOUMA INC. (maiouma.com) | category; occasion; price | 10 | 3 | 13 | 4 | Qty (9), Size (8), Color (5), Size  (2) | Rose Candle | Glass Jar Scented Candle | Crystal Clam Shell With Pearl |
| Sullivan & Bleeker Baking Co. (sullivanbleeker.com) | category; personalization; dietary | 8 | 5 | 13 | 450 | Size (2), Title (1), Flavour (1) | The Ultimate Dessert Collection Box: Grand Nut-Free Gift | Cookie & Candy Gift Box | Same Day Gift Delivery Toronto | Pe |
| Crave Cupcakes (www.cravecupcakes.ca) | personalization; dietary; bulk | 8 | 2 | 13 | 400 | Size (2), Allergy options (1) | Build Your Own Half Dozen Cookie Assortment | Vegan Confetti Cookie | Vegan Chocolate Chip Cookie |
| The Sugar Cube (www.sugarcubeyyc.com) | category; personalization; bulk | 5 | 5 | 13 | 7000 | Quantity (5), Allergen (4), Size (4), Colour theme (1) | Custom Candy Bags | Custom Candy Bags | Custom Stickered Surprise Bags |
| YORKVILLE's (yorkvilles.ca) | category; dietary; sentence | 5 | 0 | 13 | 3899 |  | Chocolate Dipped Strawberry Box | A Canadian Dessert Box | The Exotic Chocolate Box |
| Bargain Balloons USA (bargainballoons.com) | bulk; price; sentence | 5 | 1 | 13 | 5 | Color (1), Size (1) | 12" Kalisan Brand Latex Balloons Aura Ivory White (50 Per Bag) | 12" Standard White Decomex Latex Balloons (100 Per Bag) |
| The Gourmet Gifts (thegourmetgifts.ca) | dietary; occasion; sentence | 4 | 1 | 13 | 5999 |  | Vegan Gift Basket | Prestige Corporate Basket | The Corporate Delight Hamper |
| Readymade Play Canada  (readymadeplaycanada.com) | category; personalization; bulk | 3 | 0 | 404 | 550 |  | Party Favours! | Party Favours! | Party Favours! |
| Genius Gems (geniusgems.com) | category; occasion; sentence | 3 | 0 | 13 | 2117 | Option (3) | Goody Bags | Goody Bags | Goody Bags |
| Party Expert USA (www.party-expert.com) | category; personalization; occasion | 3 | 3 | 13 | 397 |  | Pokémon Birthday Favour Bags, 8 count | Pokémon Birthday Favour Bags, 8 count | Pokémon Birthday Favour Bags, 8 count |
| Cookista (cookista.ca) | category; personalization; dietary | 3 | 3 | 13 | 125 | Packaging (3) | Cookie Favors | Cookie Favors | Cookie Favors |
| Levain Bakery (levainbakery.com) | category; personalization; bulk | 3 | 3 | 13 | 5200 | Size (3) | Build Your Own Cookie Box | Build Your Own Cookie Box | Build Your Own Cookie Box |
| GiftAFeeling (www.giftafeeling.com) | category; personalization; occasion | 3 | 1 | 13 | 220 | Quantity (3), Colors (2), Color (1) | Laminated Fashion Tote | Custom Name Engraved Slate Coasters | Meeting Mastery + Merch Box 3-Piece Gift Set |
| Ibiza One Stop (ibizaonestop.com) | category; personalization | 14 | 10 | 13 | 2464 |  | Nautical Sailor Knot Coaster (Set of 4) - Red Handmade in Maine from Recycled Sails | Love Notes Medium Tote Handmade in |
| Pretty Day (www.prettyday.com) | category; occasion | 13 | 0 | 13 | 2034 |  | Multi Surprise Balls | Toybox Icon Party Bags 8pk. | Charm Party Bags 8pk. |
| Present Agent (store.presentagent.vip) | category; dietary | 11 | 0 | 13 | 4110 |  | Taste of Di Bruno Cheese & Charcuterie Gourmet Gift Box | Montana Tote | Magnolia Kelly Green Retro Tote |
| HAZELTON's (www.hazeltons.ca) | category; dietary | 8 | 0 | 13 | 3899 |  | The Soft Luxe Sweets Box | Sweet Birthday Blush Gift Box | Shared Sweetness Strawberries & Macarons Gift Box |
| Party Warehouse | occasion; bulk | 6 | 0 | 13 | 169 |  | Cocomelon Paper Craft Bags-8Pcs | Bluey Blowouts-8ct | Hot Wheels Blowouts-8PCS |
| CONFETTIMYPARTY (www.confettimyparty.com) | category; occasion | 5 | 0 | 13 | 2550 |  | PRINCESS PARTY BAGS BY MERI MERI | ROCKET PARTY BAGS BY MERI MERI | GINGHAM FRINGE PARTY BAGS BY MERI MERI |
| Vancouver Blooms (vancouverblooms.ca) | category; sentence | 5 | 2 | 13 | 5999 |  | Cakecicle Dessert Gift Box | Gourmet Craft Beer & Dessert Gift Box | Complete Macaron & Flower Gift Box |
| Bunner's Bakeshop (bunners.ca) | personalization; dietary | 5 | 1 | 13 | 400 |  | 1 Dozen Custom Sugar Cookies | Cookies and Creamio | Chocolate Chip Creamie |
| BH Food Group (bhfoodgroup.com) | dietary; bulk | 5 | 0 | 13 | 2900 |  | 305 Cookie-RTB-06 Matcha Choco Duo (Vegan) (12pc) | 302 Cookie-RTB-03 Dark Chocolate Hazelnut Bliss (12pc) | 300 Cookie- |
| Lemon And Lavender Toronto (shop.lemonlavender.com) | category; occasion | 4 | 0 | 13 | 2999 |  | Surprise Cake Slices | Meri Meri | Stripe Party Bags (Set of 8)-Meri Meri | Stripe Party Bags (Set of 8)-Meri Meri |
| Buchan's Kerrisdale Stationery (www.buchanst.com) | category; occasion | 4 | 0 | 13 | 2599 |  | MERI MERI - Multicolor Star Confetti Cracker | MERI MERI - Animal Parade Party Bags - Pack of 8 | MERI MERI - Animal Par |
| Foodiepages (www.foodiepages.ca) | category; dietary | 4 | 0 | 13 | 4000 |  | Smile Gift Box (Reachdesk Canada) | SMILE Gift Box (Reachdesk USA) | Coffee & Fresh-Baked Cookies |
| Heavenpartyflowers (heavenpartyflowers.com) | category; occasion | 4 | 1 | 13 | 8800 | Quantity (4), Fragrance oil (3), Tea option (1) | Soy Candle Favors | Flower Candle favors | Soy Candle Favors |
| Memories Made Custom (memoriesmade.ca) | category; personalization | 4 | 4 | 13 | 800 |  | Custom Engraved Cork Coasters | Personalized, Designed & Engraved in Canada | Custom Engraved Cork Coasters | Personaliz |
| Lobo Worldwide Inc. (www.loboworldwide.com) | dietary; sentence | 4 | 0 | 13 | 3684 |  | (3 pack) OREO Gluten Free Chocolate Sandwich Cookies, Gluten Free Cookies, 12.08 oz | OREO Double Stuf Gluten Free Choco |
| YVR Cookie (yvrcookie.com) | dietary; bulk | 4 | 0 | 13 | 874 | Size (3) | GF Chocolate Chunk | Assorted Cookie | Double Chocolate Chunk |
| MY BASKETS (www.mybaskets.ca) | dietary; occasion | 4 | 0 | 13 | 3900 |  | Assorted Chocolate Box | Corporate Gift With Wine | Corporate Gift with 2 Wine |
| The Cross Living (www.thecrossliving.com) | category; occasion | 3 | 0 | 13 | 3000 |  | Mermaid Party Bags | Mermaid Party Bags | Dinosaur Kingdom Party Bags |
| Dazzling Party and Balloons (dazzlingballoons.ca) | category; bulk | 3 | 0 | 13 | 2195 |  | Hello Kitty & Friends Favor Pack 48 Pack | Pokemon Mega Pack Value Mix Party Favors 48/PCS | Hello Kitty & Friends Favor |
| Blue Sheep Bake Shop (bluesheepbakeshop.com) | category; personalization | 3 | 1 | 13 | 395 |  | 2 Count Cookie Favors | Chocolate Luxe Birthday Bento Gift Box | Cake, Cupcakes & Macarons | Printed Cookies  - $5.95 |
| The Qutie Trinx Company (thequtietrinxcompany.ca) | category; occasion | 3 | 3 | 13 | 850 | Theme (1), Type (1), Vinyl (1) | 4oz - Personalized Candle Favours - 'Thank You' Coconut Candles - 15 pcs | 4oz - Personalized Baby Shower Candle Favours |
| Whiteroomfavors | category; occasion | 3 | 3 | 13 | 3105 |  | 10 pcs Favors for Guests, Wedding Favors, Rustic Wedding, Custom Favors, Sunflower Favors, Rustic Favors, Sunflower Part |
| Confetti Sweets - Sherwood Park (confettisweets.ca) | personalization; bulk | 3 | 3 | 13 | 2500 | Number of cookies (1) | Printed Cookie Box Set | Custom Printed Cookies | Custom Printed Cookies |
| Sugar Dream Cookies & Supplies (sugardreamcookies.ca) | personalization; bulk | 3 | 3 | 13 | 350 | Cookie flavours (2), Icing flavour (2), Cookie flavour (1) | Large Custom Cookies | Small Logo and Specialty Printed Cookies | Large Custom Cookies |
| WellBox (wellboxes.co.uk) | dietary; sentence | 3 | 0 | 13 | 1495 | Dietary options (1) | Dough! Letterbox Cookies | Vegan and Gluten Free Chocolate Gift | Home |
| ANNE of Green Gables Chocolates (annechocolates.com) | dietary; sentence | 3 | 0 | 13 | 3998 |  | Handmade Heaven Gift Box | Localicious Gift Box | Handmade Heaven Gift Box |
| J&F Gift Inc (jfgiftinc.com) | occasion; sentence | 3 | 1 | 13 | 2490 |  | Gratitude Mini (Green) | Simple Thanks | Home & Heart |
| Dollar Max Dépôt (www.dollarmaxdepot.com) | bulk; sentence | 3 | 0 | 13 | 249 |  | Wilton 25 Clear Plastic Party Bags with Ties 4x9.5in | Building Blocks 8 Paper Cups 9oz | Mermaid Honeycomb Centerpiece  |
| Vancouver Baskets (vancouverbaskets.ca) | category; sentence | 2 | 0 | 13 | 7499 |  | Birthday Bash Dessert Box | Birthday Bash Dessert Box |
| Hamilton Baskets (hamiltonbaskets.ca) | category; sentence | 2 | 0 | 13 | 7499 |  | Birthday Bash Dessert Box | Birthday Bash Dessert Box |
| The Brownie Blondie | category; sentence | 2 | 0 | 13 | 8000 |  | Party Dessert Box (12 Pieces) | Party Dessert Box (12 Pieces) |
| Love and Flour (loveandflour.ca) | category; sentence | 2 | 0 | 13 | 195 |  | Clear Dessert Box w/handle | Clear Dessert Box w/handle |
| Cured Catering (www.ordercured.com) | category; sentence | 2 | 0 | 13 | 2000 | Size (2) | Dessert Box | Charcuterie + Dessert Combo |
| Flour & Flower (www.flourandflower.ca) | category; dietary | 2 | 0 | 13 | 4500 | Size (1), Flavour (1) | Garden Box | VEGAN Mini Imperials |
| Kitten and the Bear (www.kittenandthebear.com) | category; sentence | 2 | 0 | 13 | 3200 |  | KATB Sweets Box | KATB Sweets Box |
| Fair/Square (fair-square.ca) | category; dietary | 2 | 1 | 13 | 6495 | Dietary preference (2) | Sweets & Treats Gift Box | Chocolate Lover Gift Box |
| Sugar Love Designs (sugarlovedesigns.com) | category; sentence | 2 | 0 | 13 | 350 |  | DIY Christmas Dessert Boxes | DIY Christmas Dessert Boxes |
| Lynn & Liana Designs (lynnliana.com) | category; sentence | 2 | 0 | 13 | 3900 | Color (2) | Ceramic Coasters (set of 4) | Acrylic Serving Tray |
| Simply Gifted  (simplygifted.ca) | category; personalization | 2 | 1 | 13 | 1200 |  | Giftology - Burlington Tote bag | Crawford Custom Engraving - Taylor Swift Albums Acrylic- Evermore |
| Precious Memories Co (preciousmemoriesco.ca) | category; personalization | 2 | 2 | 13 | 2800 | Quantity in set (1) | Personalized Tote Bag, Custom Silicone Tote Bag, Custom Engraved Tote Bag, Teacher's Tote, Beach Bag, Mother's Day Gift, |
| Peacock Bakehouse (peacockbakehouse.com) | personalization; bulk | 2 | 0 | 13 | 4400 | Flavours (1) | Six of a Kind - Choose Your Own Flavour | Mega-stuffed Cookie Box - 6 Assorted Flavours |
| The Warehouse Liquidation (thewarehouseliquidation.com) | occasion; sentence | 2 | 0 | 13 | 1999 |  | NEW 12 PCS Kids Dinosaur Party Favor Bags for Birthday Party Gift Package, Animal Drawstring Bag Cartoon Dinosaur Birthd |
| Black Bow Gift Co. (blackbowgiftco.ca) | occasion; sentence | 2 | 0 | 13 | 9000 | Your choice of mini dish (1) | Ambition & Appreciation | Take It Easy |

Every seller, including those one search type returned, is in sellers-ca.csv.

## Variant option names across every product row

| Option name | Rows |
| --- | --- |
| Quantity | 55 |
| Color | 53 |
| Size | 51 |
| Title | 38 |
| Style | 11 |
| Qty | 10 |
| Options | 10 |
| Flavour | 8 |
| Condition | 8 |
| Add a decorated cookie | 6 |
| Favor options | 6 |
| Colour | 6 |
| Shape | 6 |
| Packaging | 5 |
| Pack size | 5 |
| Scent | 5 |
| Allergen | 4 |
| Option | 4 |
| Select the packaging | 4 |
| Coaster shape | 4 |
| Fragrance oil | 3 |
| Select the shape | 3 |
| Select the ribbon colour (if ribbon option selected above) | 3 |
| Number of cookies | 3 |
| Type | 3 |

## The four card categories against the catalog

| Card | Kind | Query | Filter value | Returned | Catalog total | Titles or messages |
| --- | --- | --- | --- | --- | --- | --- |
| gift | query | gift sets |  | 10 | 439 | SOL DE JANEIRO Beija Flor Jet Set | Coffret cadeau de naissance et shower de bébé | Luxury Gift Set (No.04 Boi |
| food | query | food and drink gifts |  | 10 | 410 | Warm Urban Sips Gourmet Gift Basket | Classic Pub Treats with Guinness & Brie | Refreshing Cocktail & Fruit Gi |
| apparel | query | apparel gifts |  | 10 | 414 | Poko Apparel Bundle | Honor The Gift Washed Twill Trucker Jacket / Taupe | 5-Pack Mystery Box | 686 Everywhere |
| stationery | query | stationery gifts |  | 10 | 403 | Ultimate Subscription | Ensemble cadeau le p’tit parfait ! | Writing Gift Set - Send With Love | Best Nyangnya |
| categories filter | categories | party favors | Gift Sets | 0 | 0 |  |
| categories filter | categories | party favors | Food & Drink | 0 | 0 |  |
| categories filter | categories | party favors | Apparel & Accessories | 0 | 0 |  |
| categories filter | categories | party favors | Stationery | 0 | 0 |  |
| categories filter | categories | party favors | Party Favors | 0 | 0 |  |
| categories filter | categories | party favors | Arts & Entertainment > Party & Celebration > Party Supplies > Party Favors | 0 | 0 |  |
| categories filter | categories | party favors | gid://shopify/TaxonomyCategory/ae-2-1-3 | 0 | 0 |  |
| categories filter | categories | party favors | ae-2 | 10 | 121 |  |
| categories filter | categories | party favors | fb | 10 | 144 |  |
| categories filter | categories | party favors | aa | 10 | 118 |  |
| categories filter | categories | party favors | op | 0 | 0 |  |
| price tier | price_tier | party favors | low | 10 | 429 |  |
| price tier | price_tier | party favors | medium | 10 | 426 |  |
| price tier | price_tier | party favors | high | 10 | 298 |  |
